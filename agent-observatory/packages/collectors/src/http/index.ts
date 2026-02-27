/**
 * HTTP Collector — Phase 1 스텁.
 *
 * 범용 UAEP POST 수신 엔드포인트.
 * Phase 2에서 구현 예정.
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';

/** HTTP Collector 설정 (Phase 1: 미사용) */
export interface HTTPCollectorConfig extends CollectorConfig {
  /** 수신 포트 */
  port?: number;
  /** 수신 경로 */
  path?: string;
}

/**
 * HTTP Collector (스텁).
 *
 * Phase 1에서는 빈 구현만 제공.
 */
export class HTTPCollector implements Collector {
  readonly name = 'HTTPCollector';
  readonly sourceType = 'custom' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: HTTPCollectorConfig) {
    // Phase 1: 스텁
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onEvent(_handler: (event: UAEPEvent) => void): void {
    // Phase 1: 스텁
  }

  async start(): Promise<void> {
    // Phase 1: 스텁
  }

  async stop(): Promise<void> {
    // Phase 1: 스텁
  }
}
