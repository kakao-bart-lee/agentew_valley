import { describe, it, expect } from 'vitest';
import { HistoryStore } from '../core/history-store.js';
import { makeEvent, makeToolStart } from './helpers.js';

describe('HistoryStore', () => {
  it('should store and retrieve events by agent', () => {
    const hs = new HistoryStore();

    const e1 = makeToolStart('Read', 'agent-1');
    const e2 = makeToolStart('Bash', 'agent-1');
    hs.append(e1);
    hs.append(e2);

    const events = hs.getByAgent('agent-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(e1);
    expect(events[1]).toEqual(e2);
  });

  it('should store and retrieve events by session', () => {
    const hs = new HistoryStore();

    const e1 = makeEvent({ type: 'session.start', session_id: 'sess-1' });
    const e2 = makeToolStart('Read', 'agent-1');
    e2.session_id = 'sess-1';
    hs.append(e1);
    hs.append(e2);

    const events = hs.getBySession('sess-1');
    expect(events).toHaveLength(2);
  });

  it('should return empty array for unknown agent', () => {
    const hs = new HistoryStore();
    expect(hs.getByAgent('unknown')).toEqual([]);
  });

  it('should return empty array for unknown session', () => {
    const hs = new HistoryStore();
    expect(hs.getBySession('unknown')).toEqual([]);
  });

  it('should support pagination via limit and offset', () => {
    const hs = new HistoryStore();

    for (let i = 0; i < 10; i++) {
      hs.append(makeToolStart(`tool-${i}`, 'agent-1'));
    }

    const page1 = hs.getByAgent('agent-1', { limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = hs.getByAgent('agent-1', { limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0]).not.toEqual(page1[0]);
  });

  it('should filter by type', () => {
    const hs = new HistoryStore();

    hs.append(makeEvent({ type: 'session.start', agent_id: 'agent-1' }));
    hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1' }));
    hs.append(makeEvent({ type: 'tool.end', agent_id: 'agent-1' }));

    const events = hs.getByAgent('agent-1', { type: 'tool.start' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool.start');
  });

  it('should cap events at 500 per agent (ring buffer)', () => {
    const hs = new HistoryStore();

    for (let i = 0; i < 600; i++) {
      hs.append(makeToolStart(`tool-${i}`, 'agent-1'));
    }

    expect(hs.getAgentEventCount('agent-1')).toBe(500);
    // oldest events should have been trimmed
    const events = hs.getByAgent('agent-1', { limit: 1, offset: 0 });
    expect((events[0].data as { tool_name: string }).tool_name).toBe('tool-100');
  });
});
