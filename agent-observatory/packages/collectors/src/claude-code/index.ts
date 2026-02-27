/**
 * ClaudeCodeCollector — Claude Code JSONL 수집기.
 *
 * Collector 인터페이스를 구현하며,
 * Watcher -> Parser -> Normalizer 파이프라인으로
 * JSONL 파일의 변경사항을 UAEPEvent로 변환한다.
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';
import { ClaudeCodeWatcher } from './watcher.js';
import {
  createContext,
  normalize,
  extractSessionId,
  type NormalizerContext,
} from './normalizer.js';

/** Claude Code Collector 전용 설정 */
export interface ClaudeCodeCollectorConfig extends CollectorConfig {
  /** 에이전트 인덱스 (표시 이름에 사용) */
  agentIndex?: number;
}

/**
 * Claude Code JSONL Collector.
 *
 * 사용법:
 * ```typescript
 * const collector = new ClaudeCodeCollector({
 *   watchPaths: ['~/.claude/projects']
 * });
 * collector.onEvent((event) => console.log(event));
 * await collector.start();
 * ```
 */
export class ClaudeCodeCollector implements Collector {
  readonly name = 'ClaudeCodeCollector';
  readonly sourceType = 'claude_code' as const;

  private readonly watcher: ClaudeCodeWatcher;
  private readonly config: ClaudeCodeCollectorConfig;
  private handlers: Array<(event: UAEPEvent) => void> = [];
  private contexts = new Map<string, NormalizerContext>();
  private agentCounter = 0;

  constructor(config: ClaudeCodeCollectorConfig) {
    this.config = config;
    this.watcher = new ClaudeCodeWatcher({
      watchPaths: config.watchPaths,
      tailOnly: config.tailOnly,
    });

    this.watcher.onRecords((filePath, records, isNewFile) => {
      this.handleRecords(filePath, records, isNewFile);
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

  /** 파일별 NormalizerContext 획득 또는 생성 */
  private getContext(filePath: string): NormalizerContext {
    let ctx = this.contexts.get(filePath);
    if (!ctx) {
      this.agentCounter++;
      ctx = createContext(
        filePath,
        this.config.agentIndex ?? this.agentCounter,
      );
      this.contexts.set(filePath, ctx);
    }
    return ctx;
  }

  /** Watcher에서 전달받은 레코드 처리 */
  private handleRecords(
    filePath: string,
    records: import('./parser.js').CCParsedRecord[],
    isNewFile: boolean,
  ): void {
    const ctx = this.getContext(filePath);

    // 새 파일 -> session.start 이벤트
    if (isNewFile) {
      const sessionId = extractSessionId(filePath);
      this.emit({
        ts: new Date().toISOString(),
        seq: 0,
        event_id: generateEventId(),
        source: 'claude_code',
        agent_id: ctx.agentId,
        agent_name: ctx.agentName,
        session_id: sessionId,
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
export type { CCParsedRecord, CCToolUse, CCToolResult, CCTurnDuration, CCUserInput, CCSubagentProgress } from './parser.js';
export { normalize, normalizeAll, createContext, extractSessionId, buildAgentId } from './normalizer.js';
export type { NormalizerContext } from './normalizer.js';
