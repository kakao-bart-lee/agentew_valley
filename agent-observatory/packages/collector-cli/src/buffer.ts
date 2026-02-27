/**
 * EventBuffer — 오프라인 이벤트 버퍼.
 *
 * 서버 연결이 끊겼을 때 이벤트를 임시 저장하고,
 * 재접속 시 순차 전송한다.
 *
 * 메모리 기반 (기본) 또는 파일 기반 (--buffer-path 지정 시).
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import type { UAEPEvent } from '@agent-observatory/shared';

const MAX_BUFFER_EVENTS = 10_000;

export class EventBuffer {
  private memory: UAEPEvent[] = [];
  private filePath?: string;

  constructor(filePath?: string) {
    this.filePath = filePath;

    // Load existing buffer file on startup
    if (filePath && existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content) {
          for (const line of content.split('\n')) {
            try {
              this.memory.push(JSON.parse(line) as UAEPEvent);
            } catch {
              // skip malformed lines
            }
          }
          // Truncate if over limit
          if (this.memory.length > MAX_BUFFER_EVENTS) {
            this.memory = this.memory.slice(-MAX_BUFFER_EVENTS);
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }

  /** Buffer events for later transmission. Drops oldest if over limit. */
  push(events: UAEPEvent[]): void {
    this.memory.push(...events);

    // Enforce max size — drop oldest
    if (this.memory.length > MAX_BUFFER_EVENTS) {
      this.memory = this.memory.slice(-MAX_BUFFER_EVENTS);
    }

    // Append to file if file-based
    if (this.filePath) {
      try {
        const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
        appendFileSync(this.filePath, lines);
      } catch {
        // ignore write errors
      }
    }
  }

  /** Drain up to batchSize events from the front. */
  drain(batchSize: number): UAEPEvent[] {
    const batch = this.memory.splice(0, batchSize);

    // Rewrite file if file-based
    if (this.filePath && batch.length > 0) {
      this.syncToFile();
    }

    return batch;
  }

  /** Number of buffered events. */
  get size(): number {
    return this.memory.length;
  }

  private syncToFile(): void {
    if (!this.filePath) return;
    try {
      const content = this.memory.map((e) => JSON.stringify(e)).join('\n');
      writeFileSync(this.filePath, content ? content + '\n' : '');
    } catch {
      // ignore write errors
    }
  }
}
