/**
 * Agent SDK Hook Collector — Phase 1 스텁.
 *
 * HTTP webhook 수신 엔드포인트.
 * Phase 2에서 구현 예정.
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import type { Collector, CollectorConfig } from '../base.js';

/** Agent SDK Collector 설정 (Phase 1: 미사용) */
export interface AgentSDKCollectorConfig extends CollectorConfig {
  /** webhook 수신 포트 */
  port?: number;
}

/**
 * Agent SDK Hook Collector (스텁).
 *
 * Phase 1에서는 빈 구현만 제공.
 */
export class AgentSDKCollector implements Collector {
  readonly name = 'AgentSDKCollector';
  readonly sourceType = 'agent_sdk' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config: AgentSDKCollectorConfig) {
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
