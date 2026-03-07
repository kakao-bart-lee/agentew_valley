import { describe, it, expect, afterEach } from 'vitest';
import { HistoryStore } from '../core/history-store.js';
import { makeEvent, makeToolStart, makeSessionStart, makeMetricsUsage } from './helpers.js';

describe('HistoryStore', () => {
  let hs: HistoryStore;

  afterEach(() => {
    hs?.close();
  });

  it('should store and retrieve events by agent', () => {
    hs = new HistoryStore();

    const e1 = makeToolStart('Read', 'agent-1');
    const e2 = makeToolStart('Bash', 'agent-1');
    hs.append(e1);
    hs.append(e2);

    const events = hs.getByAgent('agent-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject(e1);
    expect(events[0].runtime).toEqual({
      family: 'claude_code',
      orchestrator: null,
      client: 'native',
    });
    expect(events[0].provenance?.dedupe_key).toMatch(/^fp_/);
    expect(events[1]).toMatchObject(e2);
    expect(events[1].runtime).toEqual({
      family: 'claude_code',
      orchestrator: null,
      client: 'native',
    });
    expect(events[1].provenance?.dedupe_key).toMatch(/^fp_/);
  });

  it('should store and retrieve events by session', () => {
    hs = new HistoryStore();

    const e1 = makeEvent({ type: 'session.start', session_id: 'sess-1' });
    const e2 = makeToolStart('Read', 'agent-1');
    e2.session_id = 'sess-1';
    hs.append(e1);
    hs.append(e2);

    const events = hs.getBySession('sess-1');
    expect(events).toHaveLength(2);
  });

  it('should persist work-context fields on events', () => {
    hs = new HistoryStore();

    const event = makeToolStart('Read', 'agent-1', undefined, {
      session_id: 'sess-work',
      project_id: 'moonlit',
      task_id: 'task-42',
      goal_id: 'goal-7',
    });
    hs.append(event);

    const [stored] = hs.getBySession('sess-work');
    expect(stored.project_id).toBe('moonlit');
    expect(stored.task_id).toBe('task-42');
    expect(stored.goal_id).toBe('goal-7');
  });

  it('should persist runtime taxonomy and provenance scaffolding on events', () => {
    hs = new HistoryStore();

    const event = makeToolStart('Read', 'agent-1', undefined, {
      session_id: 'sess-runtime',
      source: 'omx',
      runtime: {
        family: 'codex',
        orchestrator: 'omx',
        client: 'omx',
      },
      provenance: {
        ingestion_kind: 'hook',
        source_event_id: 'source-evt-1',
      },
    });
    hs.append(event);

    const [stored] = hs.getBySession('sess-runtime');
    expect(stored.runtime).toEqual({
      family: 'codex',
      orchestrator: 'omx',
      client: 'omx',
    });
    expect(stored.provenance?.source_event_id).toBe('source-evt-1');
    expect(stored.provenance?.dedupe_key).toMatch(/^fp_/);
  });

  it('should return empty array for unknown agent', () => {
    hs = new HistoryStore();
    expect(hs.getByAgent('unknown')).toEqual([]);
  });

  it('should return empty array for unknown session', () => {
    hs = new HistoryStore();
    expect(hs.getBySession('unknown')).toEqual([]);
  });

  it('should support pagination via limit and offset', () => {
    hs = new HistoryStore();

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
    hs = new HistoryStore();

    hs.append(makeEvent({ type: 'session.start', agent_id: 'agent-1' }));
    hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1' }));
    hs.append(makeEvent({ type: 'tool.end', agent_id: 'agent-1' }));

    const events = hs.getByAgent('agent-1', { type: 'tool.start' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool.start');
  });

  it('should handle large number of events (SQLite has no per-agent cap)', () => {
    hs = new HistoryStore();

    for (let i = 0; i < 600; i++) {
      hs.append(makeToolStart(`tool-${i}`, 'agent-1'));
    }

    // SQLite stores all events — no ring buffer cap
    expect(hs.getAgentEventCount('agent-1')).toBe(600);
  });

  it('should count events per agent', () => {
    hs = new HistoryStore();

    hs.append(makeToolStart('Read', 'agent-1'));
    hs.append(makeToolStart('Bash', 'agent-1'));
    hs.append(makeToolStart('Grep', 'agent-2'));

    expect(hs.getAgentEventCount('agent-1')).toBe(2);
    expect(hs.getAgentEventCount('agent-2')).toBe(1);
    expect(hs.getAgentEventCount('unknown')).toBe(0);
  });

  it('should list session IDs', () => {
    hs = new HistoryStore();

    hs.append(makeEvent({ type: 'tool.start', session_id: 'sess-a' }));
    hs.append(makeEvent({ type: 'tool.start', session_id: 'sess-b' }));
    hs.append(makeEvent({ type: 'tool.start', session_id: 'sess-a' }));

    const ids = hs.getSessionIds();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('sess-a');
    expect(ids).toContain('sess-b');
  });

  it('should ignore duplicate event_ids', () => {
    hs = new HistoryStore();

    const e1 = makeToolStart('Read', 'agent-1');
    hs.append(e1);
    hs.append(e1); // same event_id

    expect(hs.getAgentEventCount('agent-1')).toBe(1);
  });

  describe('sessions table', () => {
    it('should create session record on session.start', () => {
      hs = new HistoryStore();
      const e = makeSessionStart('agent-1', 'sess-1');
      hs.append(e);

      const summaries = hs.getSessionSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].session_id).toBe('sess-1');
      expect(summaries[0].agent_id).toBe('agent-1');
      expect(summaries[0].agent_name).toBe('agent-1');
    });

    it('should set end_time on session.end', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeEvent({ type: 'session.end', agent_id: 'agent-1', session_id: 'sess-1' }));

      const summaries = hs.getSessionSummaries();
      expect(summaries[0].end_time).toBeTruthy();
    });

    it('should increment total_events', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      hs.append(makeToolStart('Bash', 'agent-1', undefined, { session_id: 'sess-1' }));

      const summaries = hs.getSessionSummaries();
      // session.start + 2 tool.starts = 3 events
      expect(summaries[0].total_events).toBe(3);
    });

    it('should accumulate tokens and cost from metrics.usage', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeMetricsUsage(100, 0.05, 'agent-1', { session_id: 'sess-1' }));
      hs.append(makeMetricsUsage(200, 0.10, 'agent-1', { session_id: 'sess-1' }));

      const summaries = hs.getSessionSummaries();
      expect(summaries[0].total_tokens).toBe(300);
      expect(summaries[0].total_cost_usd).toBeCloseTo(0.15);
    });

    it('should inherit first non-null work context onto the session rollup', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1'));
      hs.append(makeToolStart('Read', 'agent-1', undefined, {
        session_id: 'sess-1',
        project_id: 'moonlit',
        task_id: 'task-42',
      }));
      hs.append(makeMetricsUsage(100, 0.05, 'agent-1', {
        session_id: 'sess-1',
        goal_id: 'goal-7',
      }));

      const summaries = hs.getSessionSummaries();
      expect(summaries[0].project_id).toBe('moonlit');
      expect(summaries[0].task_id).toBe('task-42');
      expect(summaries[0].goal_id).toBe('goal-7');
    });

    it('should carry runtime/task-context scaffolding onto the session rollup', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1', {
        source: 'omx',
        runtime: {
          family: 'codex',
          orchestrator: 'omx',
          client: 'omx',
        },
        task_context: {
          provider: 'paperclip',
          issue_identifier: 'ISSUE-42',
        },
      }));

      const summaries = hs.getSessionSummaries();
      expect(summaries[0].runtime_family).toBe('codex');
      expect(summaries[0].runtime_orchestrator).toBe('omx');
      expect(summaries[0].task_context).toContain('ISSUE-42');
    });

    it('should update agent_name when later events provide a richer label', () => {
      hs = new HistoryStore();
      hs.append(makeSessionStart('agent-1', 'sess-1', { agent_name: 'OpenCode' }));
      hs.append(makeEvent({
        type: 'llm.end',
        source: 'opencode',
        agent_id: 'agent-1',
        session_id: 'sess-1',
        agent_name: 'Atlas (Plan Executor)',
      }));

      const session = hs.getSession('sess-1');
      expect(session?.agent_name).toBe('Atlas (Plan Executor)');
    });
  });

  describe('FTS search', () => {
    it('should search events by type', () => {
      hs = new HistoryStore();
      hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1', data: { tool_name: 'Read' } }));
      hs.append(makeEvent({ type: 'tool.end', agent_id: 'agent-1', data: { tool_name: 'Read' } }));
      hs.append(makeEvent({ type: 'session.start', agent_id: 'agent-1' }));

      const results = hs.search('tool.start');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('tool.start');
    });

    it('should search events by data content', () => {
      hs = new HistoryStore();
      hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1', data: { tool_name: 'Read' } }));
      hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1', data: { tool_name: 'Bash' } }));

      const results = hs.search('Bash');
      expect(results).toHaveLength(1);
    });

    it('should search events by agent_id', () => {
      hs = new HistoryStore();
      hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-alpha' }));
      hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-beta' }));

      const results = hs.search('agent-alpha');
      expect(results).toHaveLength(1);
    });

    it('should return count for search', () => {
      hs = new HistoryStore();
      hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1', data: { tool_name: 'Read' } }));
      hs.append(makeEvent({ type: 'tool.end', agent_id: 'agent-1', data: { tool_name: 'Read' } }));

      const count = hs.searchCount('Read');
      expect(count).toBe(2);
    });

    it('should support pagination in search', () => {
      hs = new HistoryStore();
      for (let i = 0; i < 5; i++) {
        hs.append(makeEvent({ type: 'tool.start', agent_id: 'agent-1', data: { tool_name: 'Read' } }));
      }

      const page1 = hs.search('Read', { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = hs.search('Read', { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
    });
  });

  describe('getDb', () => {
    it('should expose the database instance', () => {
      hs = new HistoryStore();
      const db = hs.getDb();
      expect(db).toBeDefined();
      // Verify it's a working database
      const result = db.prepare('SELECT 1 as val').get() as { val: number };
      expect(result.val).toBe(1);
    });
  });

  describe('file persistence', () => {
    it('should persist data when given a file path', async () => {
      const path = '/tmp/test-history-store-' + Date.now() + '.db';

      // Write data
      const hs1 = new HistoryStore(path);
      hs1.append(makeSessionStart('agent-1', 'sess-1'));
      hs1.append(makeToolStart('Read', 'agent-1'));
      hs1.close();

      // Read back
      const hs2 = new HistoryStore(path);
      expect(hs2.getAgentEventCount('agent-1')).toBe(2);
      const summaries = hs2.getSessionSummaries();
      expect(summaries).toHaveLength(1);
      hs2.close();

      // Cleanup
      const { unlinkSync } = await import('node:fs');
      try { unlinkSync(path); } catch { /* ignore */ }
      try { unlinkSync(path + '-wal'); } catch { /* ignore */ }
      try { unlinkSync(path + '-shm'); } catch { /* ignore */ }
    });
  });
});
