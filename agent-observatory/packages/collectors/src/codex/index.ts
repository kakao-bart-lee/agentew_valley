/**
 * CodexCollector — Codex JSONL 수집기.
 *
 * Collector 인터페이스를 구현하며,
 * ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 파일을 감시하여
 * UAEPEvent로 변환한다.
 */

import { watch, type FSWatcher } from 'chokidar';
import { open, stat } from 'node:fs/promises';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';
import { normalizeWatchPaths } from '../path-utils.js';
import { parseLine } from './parser.js';
import { createContext, normalize, type CdxNormalizerContext } from './normalizer.js';

export interface CodexCollectorConfig extends CollectorConfig {
  /** true면 기존 파일은 끝 위치만 기록하고 건너뜀. 기본 false. */
  tailOnly?: boolean;
}

/**
 * Codex JSONL Collector.
 *
 * 사용법:
 * ```typescript
 * const collector = new CodexCollector({
 *   watchPaths: ['~/.codex/sessions']
 * });
 * collector.onEvent((event) => console.log(event));
 * await collector.start();
 * ```
 */
export class CodexCollector implements Collector {
  readonly name = 'CodexCollector';
  readonly sourceType = 'codex' as const;

  private readonly config: CodexCollectorConfig;
  private watcher: FSWatcher | null = null;
  private handlers: Array<(event: UAEPEvent) => void> = [];
  /** filePath → NormalizerContext */
  private contexts = new Map<string, CdxNormalizerContext>();
  /** filePath → byte offset */
  private offsets = new Map<string, number>();

  constructor(config: CodexCollectorConfig) {
    this.config = config;
  }

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    const targets = normalizeWatchPaths(this.config.watchPaths);

    this.watcher = watch(targets, {
      persistent: true,
      ignoreInitial: false,
      usePolling: false,
      ignored: (_filePath: string, stats?: { isFile(): boolean }) =>
        stats?.isFile() === true && !_filePath.toLowerCase().endsWith('.jsonl'),
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on('add', (filePath: string) => {
      if (!this.isCodexFile(filePath)) return;
      if (this.config.tailOnly) {
        void this.skipToEnd(filePath);
      } else {
        void this.handleFile(filePath, true);
      }
    });

    this.watcher.on('change', (filePath: string) => {
      if (!this.isCodexFile(filePath)) return;
      void this.handleFile(filePath, false);
    });

    this.watcher.on('unlink', (filePath: string) => {
      if (!this.isCodexFile(filePath)) return;
      this.handleFileRemoved(filePath);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.contexts.clear();
    this.offsets.clear();
    this.handlers = [];
  }

  private emit(event: UAEPEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private isCodexFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.jsonl');
  }

  /**
   * 파일 경로에서 세션 ID를 추출한다.
   * 예: rollout-2026-03-07T00-33-12-019cc3c8-09e1-7782-ba7a-5be9e059261f.jsonl
   *   → 019cc3c8-09e1-7782-ba7a-5be9e059261f
   */
  private extractSessionIdFromPath(filePath: string): string {
    const fileName = filePath.split('/').pop() ?? '';
    // rollout-{datetime}-{uuid}.jsonl 형식에서 UUID 부분 추출
    // 마지막 다섯 개의 '-' 구분 부분이 UUID (8-4-4-4-12)
    const withoutExt = fileName.replace(/\.jsonl$/i, '');
    const parts = withoutExt.split('-');
    if (parts.length >= 5) {
      // 마지막 5개 파트를 UUID 형식으로 재조합
      const uuidParts = parts.slice(-5);
      return uuidParts.join('-');
    }
    return withoutExt;
  }

  private getContext(filePath: string): CdxNormalizerContext {
    let ctx = this.contexts.get(filePath);
    if (!ctx) {
      const sessionId = this.extractSessionIdFromPath(filePath);
      ctx = createContext(sessionId);
      this.contexts.set(filePath, ctx);
    }
    return ctx;
  }

  private handleFileRemoved(filePath: string): void {
    const ctx = this.contexts.get(filePath);
    if (ctx && ctx.sessionStarted) {
      this.emit({
        ts: new Date().toISOString(),
        event_id: generateEventId(),
        source: 'codex',
        agent_id: ctx.agentId,
        agent_name: ctx.agentName,
        session_id: ctx.sessionId,
        ...(ctx.projectId !== undefined ? { project_id: ctx.projectId } : {}),
        ...(ctx.modelId !== undefined ? { model_id: ctx.modelId } : {}),
        type: 'session.end',
        data: { reason: 'file_removed' },
      });
    }
    this.contexts.delete(filePath);
    this.offsets.delete(filePath);
  }

  private async skipToEnd(filePath: string): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      this.offsets.set(filePath, fileStat.size);
      // 컨텍스트 초기화 (tailOnly에서도 파일 삭제 시 session.end 발행을 위해)
      this.getContext(filePath);
    } catch {
      // 파일 접근 실패 무시
    }
  }

  private async handleFile(filePath: string, isNewFile: boolean): Promise<void> {
    try {
      const fileStat = await stat(filePath);
      const currentSize = fileStat.size;
      const offset = this.offsets.get(filePath) ?? 0;

      if (currentSize <= offset) return;

      const bytesToRead = currentSize - offset;
      const buffer = Buffer.alloc(bytesToRead);

      const fh = await open(filePath, 'r');
      try {
        await fh.read(buffer, 0, bytesToRead, offset);
      } finally {
        await fh.close();
      }

      this.offsets.set(filePath, currentSize);

      const text = buffer.toString('utf-8');
      const ctx = this.getContext(filePath);

      for (const line of text.split('\n')) {
        const records = parseLine(line);
        for (const record of records) {
          const events = normalize(record, ctx);
          for (const event of events) {
            this.emit(event);
          }
        }
      }

      // 새 파일이고 session.start가 발행되지 않았으면 (session_meta 없음) fallback
      if (isNewFile && !ctx.sessionStarted) {
        ctx.sessionStarted = true;
        this.emit({
          ts: new Date().toISOString(),
          event_id: generateEventId(),
          source: 'codex',
          agent_id: ctx.agentId,
          agent_name: ctx.agentName,
          session_id: ctx.sessionId,
          ...(ctx.projectId !== undefined ? { project_id: ctx.projectId } : {}),
          type: 'session.start',
          data: { file_path: filePath },
        });
      }
    } catch {
      // 파일 읽기 실패는 무시
    }
  }
}

export { parseLine, parseLines } from './parser.js';
export type {
  CdxParsedRecord,
  CdxSessionMeta,
  CdxTurnContext,
  CdxTaskStarted,
  CdxTaskComplete,
  CdxUserMessage,
  CdxAgentMessage,
  CdxTokenCount,
  CdxFunctionCall,
  CdxFunctionCallOutput,
} from './parser.js';
export { normalize, normalizeAll, createContext, buildAgentId } from './normalizer.js';
export type { CdxNormalizerContext } from './normalizer.js';
