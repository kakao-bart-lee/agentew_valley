import { describe, it, expect } from 'vitest';
import type { UAEPEvent } from '@agent-observatory/shared';
import { EventBuffer } from '../buffer.js';

function makeEvent(id: string): UAEPEvent {
  return {
    ts: new Date().toISOString(),
    event_id: `evt-${id}`,
    source: 'claude_code',
    agent_id: 'agent-1',
    session_id: 'session-1',
    type: 'tool.start',
    data: { tool_name: 'Read' },
  };
}

describe('EventBuffer', () => {
  it('should push and drain events', () => {
    const buf = new EventBuffer();
    const events = [makeEvent('1'), makeEvent('2'), makeEvent('3')];
    buf.push(events);

    expect(buf.size).toBe(3);

    const batch = buf.drain(2);
    expect(batch).toHaveLength(2);
    expect(batch[0].event_id).toBe('evt-1');
    expect(batch[1].event_id).toBe('evt-2');
    expect(buf.size).toBe(1);

    const rest = buf.drain(10);
    expect(rest).toHaveLength(1);
    expect(rest[0].event_id).toBe('evt-3');
    expect(buf.size).toBe(0);
  });

  it('should return empty array when draining empty buffer', () => {
    const buf = new EventBuffer();
    expect(buf.drain(10)).toEqual([]);
    expect(buf.size).toBe(0);
  });

  it('should drop oldest events when exceeding max size', () => {
    const buf = new EventBuffer();
    const events: UAEPEvent[] = [];
    for (let i = 0; i < 10_001; i++) {
      events.push(makeEvent(`${i}`));
    }
    buf.push(events);

    // Should be capped at 10000
    expect(buf.size).toBe(10_000);

    // The first event should have been dropped
    const first = buf.drain(1);
    expect(first[0].event_id).toBe('evt-1'); // 0 was dropped
  });
});
