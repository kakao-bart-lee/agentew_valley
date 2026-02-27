/**
 * EventBuffer — 오프라인 이벤트 버퍼 (메모리 기반).
 *
 * 서버 연결이 끊겼을 때 이벤트를 임시 저장하고,
 * 재접속 시 순차 전송한다.
 */

import type { UAEPEvent } from '@agent-observatory/shared';

const MAX_BUFFER_EVENTS = 10_000;

export class EventBuffer {
  private memory: UAEPEvent[] = [];

  /** Buffer events for later transmission. Drops oldest if over limit. */
  push(events: UAEPEvent[]): void {
    this.memory.push(...events);

    // Enforce max size — drop oldest
    if (this.memory.length > MAX_BUFFER_EVENTS) {
      this.memory = this.memory.slice(-MAX_BUFFER_EVENTS);
    }
  }

  /** Drain up to batchSize events from the front. */
  drain(batchSize: number): UAEPEvent[] {
    return this.memory.splice(0, batchSize);
  }

  /** Number of buffered events. */
  get size(): number {
    return this.memory.length;
  }
}
