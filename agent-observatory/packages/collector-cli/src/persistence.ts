/**
 * UAEP Persistence — UAEP 이벤트를 로컬 파일(JSONL)에 저장하거나 읽어온다.
 */

import { appendFileSync, createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { UAEPEvent } from '@agent-observatory/shared';

/**
 * UAEP 이벤트를 JSONL 파일에 추가한다.
 */
export function persistEvent(filePath: string, event: UAEPEvent): void {
  const line = JSON.stringify(event) + '\n';
  appendFileSync(filePath, line, 'utf8');
}

/**
 * JSONL 파일에서 UAEP 이벤트를 스트림으로 읽어온다.
 */
export async function* readPersistedEvents(filePath: string): AsyncGenerator<UAEPEvent> {
  if (!existsSync(filePath)) return;

  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as UAEPEvent;
    } catch (err) {
      console.error(`[persistence] Failed to parse line: ${line.slice(0, 100)}...`, err);
    }
  }
}
