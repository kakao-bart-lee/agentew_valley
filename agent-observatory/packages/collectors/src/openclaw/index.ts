/**
 * OpenClawCollector — OpenClaw JSONL 수집기.
 *
 * Collector 인터페이스를 구현하며,
 * Watcher -> Parser -> Normalizer 파이프라인으로
 * OpenClaw transcript JSONL을 UAEPEvent로 변환한다.
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';
import { OpenClawWatcher } from './watcher.js';
import {
  createContext,
  normalize,
  type OCNormalizerContext,
} from './normalizer.js';

/** OpenClaw Collector 전용 설정 */
export interface OpenClawCollectorConfig extends CollectorConfig {
  /** 에이전트 ID (표시 이름에 사용, 미지정 시 파일 경로에서 추출) */
  agentId?: string;
}

/**
 * OpenClaw JSONL Collector.
 *
 * 사용법:
 * ```typescript
 * const collector = new OpenClawCollector({
 *   watchPaths: ['~/.openclaw/agents']
 * });
 * collector.onEvent((event) => console.log(event));
 * await collector.start();
 * ```
 */
export class OpenClawCollector implements Collector {
  readonly name = 'OpenClawCollector';
  readonly sourceType = 'openclaw' as const;

  private readonly watcher: OpenClawWatcher;
  private readonly config: OpenClawCollectorConfig;
  private handlers: Array<(event: UAEPEvent) => void> = [];
  private contexts = new Map<string, OCNormalizerContext>();

  constructor(config: OpenClawCollectorConfig) {
    this.config = config;
    this.watcher = new OpenClawWatcher({
      watchPaths: config.watchPaths,
      tailOnly: config.tailOnly,
    });

    this.watcher.onRecords((filePath, records, isNewFile) => {
      this.handleRecords(filePath, records, isNewFile);
    });

    this.watcher.onFileRemoved((filePath) => {
      this.handleFileRemoved(filePath);
    });
  }

  /** 이벤트 핸들러 등록 */
  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handlers.push(handler);
  }

  /** 감시 시작 */
  async start(): Promise<void> {
    await this.watcher.start();
  }

  /** 감시 중지 */
  async stop(): Promise<void> {
    await this.watcher.stop();
    this.contexts.clear();
    this.handlers = [];
  }

  /** 이벤트를 모든 핸들러에 전달 */
  private emit(event: UAEPEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  /**
   * 파일 삭제 시 session.end 이벤트를 발행한다.
   */
  private handleFileRemoved(filePath: string): void {
    const ctx = this.contexts.get(filePath);
    if (!ctx) return;

    this.emit({
      ts: new Date().toISOString(),
      event_id: generateEventId(),
      source: 'openclaw',
      agent_id: ctx.agentId,
      agent_name: ctx.agentName,
      session_id: ctx.sessionId,
      ...(ctx.projectId !== undefined ? { project_id: ctx.projectId } : {}),
      ...(ctx.modelId !== undefined ? { model_id: ctx.modelId } : {}),
      type: 'session.end',
      data: { reason: 'file_removed' },
    });

    this.contexts.delete(filePath);
  }

  /**
   * 파일 경로에서 agentId를 추출한다.
   * 예: ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
   */
  private extractAgentIdFromPath(filePath: string): string {
    if (this.config.agentId) return this.config.agentId;

    const parts = filePath.split('/');
    const agentsIdx = parts.indexOf('agents');
    if (agentsIdx >= 0 && agentsIdx + 1 < parts.length) {
      return parts[agentsIdx + 1];
    }
    // fallback: 파일명
    const fileName = parts.pop() ?? 'unknown';
    return fileName.replace(/\.jsonl$/i, '');
  }

  /**
   * 파일 경로에서 sessionId를 추출한다.
   */
  private extractSessionIdFromPath(filePath: string): string {
    const fileName = filePath.split('/').pop() ?? '';
    return fileName.replace(/\.jsonl$/i, '');
  }

  /** 파일별 NormalizerContext 획득 또는 생성 */
  private getContext(filePath: string): OCNormalizerContext {
    let ctx = this.contexts.get(filePath);
    if (!ctx) {
      const agentId = this.extractAgentIdFromPath(filePath);
      const sessionId = this.extractSessionIdFromPath(filePath);
      ctx = createContext(agentId, sessionId);
      this.contexts.set(filePath, ctx);
    }
    return ctx;
  }

  /** Watcher에서 전달받은 레코드 처리 */
  private handleRecords(
    filePath: string,
    records: import('./parser.js').OCParsedRecord[],
    isNewFile: boolean,
  ): void {
    const ctx = this.getContext(filePath);

    // 새 파일이고 session_header가 없으면 session.start 이벤트 생성
    const hasSessionHeader = records.some((r) => r.kind === 'session_header');
    if (isNewFile && !hasSessionHeader) {
      this.emit({
        ts: new Date().toISOString(),
        seq: 0,
        event_id: generateEventId(),
        source: 'openclaw',
        agent_id: ctx.agentId,
        agent_name: ctx.agentName,
        session_id: ctx.sessionId,
        type: 'session.start',
        data: {
          file_path: filePath,
        },
      });
    }

    // 각 레코드를 정규화하여 이벤트 발행
    for (const record of records) {
      const events = normalize(record, ctx);
      for (const event of events) {
        this.emit(event);
      }
    }
  }
}

export { parseLine, parseLines } from './parser.js';
export type {
  OCParsedRecord,
  OCSessionHeader,
  OCToolCall,
  OCToolResult,
  OCUserInput,
  OCAssistantMessage,
  OCTokenUsage,
  OCCustomRecord,
} from './parser.js';
export { normalize, normalizeAll, createContext, buildAgentId, updateContextFromModelChange, updateContextFromCustom } from './normalizer.js';
export type { OCNormalizerContext } from './normalizer.js';
