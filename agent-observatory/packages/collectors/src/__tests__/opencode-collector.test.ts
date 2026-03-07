import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UAEPEvent } from '@agent-observatory/shared';
import { OpenCodeCollector } from '../opencode/index.js';

const tempDirs: string[] = [];
const dbHandles: Database.Database[] = [];

afterEach(async () => {
  for (const db of dbHandles.splice(0)) {
    db.close();
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ao-opencode-'));
  tempDirs.push(dir);
  return dir;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function createDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_compacting INTEGER,
      time_archived INTEGER,
      workspace_id TEXT
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  dbHandles.push(db);
  return db;
}

describe('OpenCodeCollector', () => {
  it('emits runtime activity from SQLite history and ACP session index', async () => {
    const root = await makeTempDir();
    const sessionsDir = join(root, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const dbPath = join(root, 'opencode.db');
    const sessionsIndexPath = join(sessionsDir, 'sessions.json');
    const db = createDb(dbPath);

    const now = Date.parse('2026-03-07T00:00:00.000Z');
    db.prepare(`
      INSERT INTO session (
        id, project_id, parent_id, slug, directory, title, version, permission,
        time_created, time_updated, time_compacting, time_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-root',
      'project-root',
      null,
      'atlas-root',
      '/tmp/demo',
      'Investigate observe-only shell',
      '1.2.20',
      '[{"permission":"task","pattern":"*","action":"allow"}]',
      now,
      now + 900,
      now + 400,
      null,
    );

    db.prepare(`
      INSERT INTO session (
        id, project_id, parent_id, slug, directory, title, version, permission,
        time_created, time_updated, time_compacting, time_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-child',
      'project-root',
      'sess-root',
      'atlas-child',
      '/tmp/demo',
      'Child task',
      '1.2.20',
      null,
      now + 50,
      now + 1000,
      null,
      now + 1000,
    );

    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'msg-user',
      'sess-root',
      now + 100,
      now + 100,
      JSON.stringify({
        role: 'user',
        time: { created: now + 100 },
        summary: 'Please inspect the activity stream',
        path: { cwd: '/tmp/demo' },
      }),
    );

    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'msg-assistant',
      'sess-root',
      now + 200,
      now + 1200,
      JSON.stringify({
        role: 'assistant',
        time: { created: now + 200, completed: now + 1200 },
        modelID: 'claude-sonnet-4-6',
        providerID: 'anthropic',
        agent: 'Atlas (Plan Executor)',
        path: { cwd: '/tmp/demo' },
      }),
    );

    const insertPart = db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertPart.run('part-step-start', 'msg-assistant', 'sess-root', now + 210, now + 210, JSON.stringify({ type: 'step-start' }));
    insertPart.run('part-reasoning', 'msg-assistant', 'sess-root', now + 250, now + 300, JSON.stringify({ type: 'reasoning', text: 'Thinking through the refactor plan.' }));
    insertPart.run('part-tool-ok', 'msg-assistant', 'sess-root', now + 350, now + 600, JSON.stringify({
      type: 'tool',
      callID: 'tool-call-ok',
      tool: 'bash',
      state: {
        status: 'completed',
        input: { command: 'git status --short' },
        output: 'M packages/web/src/App.tsx',
      },
    }));
    insertPart.run('part-tool-error', 'msg-assistant', 'sess-root', now + 650, now + 800, JSON.stringify({
      type: 'tool',
      callID: 'tool-call-error',
      tool: 'grep',
      state: {
        status: 'error',
        input: { query: 'legacy nav' },
        error: 'pattern not found',
      },
    }));
    insertPart.run('part-text', 'msg-assistant', 'sess-root', now + 900, now + 1200, JSON.stringify({
      type: 'text',
      text: 'Observe-only shell looks good. Work/Control/Admin are gone.',
    }));
    insertPart.run('part-step-finish', 'msg-assistant', 'sess-root', now + 1200, now + 1200, JSON.stringify({
      type: 'step-finish',
      reason: 'stop',
      cost: 0.12,
      tokens: {
        total: 420,
        input: 120,
        output: 250,
        reasoning: 50,
        cache: { read: 80, write: 12 },
      },
    }));

    await writeFile(sessionsIndexPath, JSON.stringify({
      'agent:opencode:acp:root': {
        sessionId: 'sess-root',
        updatedAt: now + 1300,
        label: 'Observe-only reset',
        channel: 'telegram',
        acp: {
          backend: 'acpx',
          agent: 'opencode',
          mode: 'oneshot',
          cwd: '/tmp/demo',
          state: 'running',
          lastActivityAt: now + 1300,
          identity: {
            state: 'pending',
            lastUpdatedAt: now + 1250,
          },
        },
      },
    }, null, 2));

    const events: UAEPEvent[] = [];
    const collector = new OpenCodeCollector({
      watchPaths: [dbPath, sessionsDir],
      tailOnly: false,
      pollIntervalMs: 30,
    });
    collector.onEvent((event) => events.push(event));

    try {
      await collector.start();
      await waitFor(() => {
        const types = new Set(events.map((event) => event.type));
        return types.has('session.start')
          && types.has('agent.status')
          && types.has('user.input')
          && types.has('tool.start')
          && types.has('tool.end')
          && types.has('tool.error')
          && types.has('llm.end')
          && types.has('metrics.usage')
          && types.has('subagent.spawn')
          && types.has('session.end');
      });
    } finally {
      await collector.stop();
    }

    expect(events.some((event) => event.source === 'opencode')).toBe(true);
    expect(events.some((event) => event.type === 'session.start' && event.session_id === 'sess-root' && event.agent_id === 'agent:opencode:acp:root')).toBe(true);
    expect(events.some((event) => event.type === 'subagent.spawn' && event.data?.['child_session_id'] === 'sess-child')).toBe(true);
    expect(events.some((event) => event.type === 'tool.end' && event.data?.['tool_name'] === 'bash')).toBe(true);
    expect(events.some((event) => event.type === 'tool.error' && event.data?.['tool_name'] === 'grep' && event.data?.['error'] === 'pattern not found')).toBe(true);

    const llmEnd = events.find((event) => event.type === 'llm.end');
    expect(llmEnd?.agent_name).toBe('Atlas (Plan Executor)');
    expect(llmEnd?.model_id).toBe('claude-sonnet-4-6');

    const usage = events.find((event) => event.type === 'metrics.usage');
    expect(usage?.data?.['tokens']).toBe(420);
    expect(usage?.data?.['input_tokens']).toBe(120);
    expect(usage?.data?.['output_tokens']).toBe(250);
    expect(usage?.data?.['reasoning_tokens']).toBe(50);
    expect(usage?.data?.['cost']).toBe(0.12);
  });

  it('tracks updates to existing tool rows without double-counting tool.start', async () => {
    const root = await makeTempDir();
    const sessionsDir = join(root, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    const dbPath = join(root, 'opencode.db');
    const sessionsIndexPath = join(sessionsDir, 'sessions.json');
    const db = createDb(dbPath);
    await writeFile(sessionsIndexPath, '{}');

    const now = Date.parse('2026-03-07T01:00:00.000Z');
    db.prepare(`
      INSERT INTO session (
        id, project_id, parent_id, slug, directory, title, version, permission,
        time_created, time_updated, time_compacting, time_archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'sess-live',
      'project-live',
      null,
      'live-slug',
      '/tmp/live',
      'Live update',
      '1.2.20',
      null,
      now,
      now,
      null,
      null,
    );

    db.prepare(`
      INSERT INTO message (id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'msg-live',
      'sess-live',
      now + 10,
      now + 10,
      JSON.stringify({
        role: 'assistant',
        time: { created: now + 10 },
        modelID: 'gpt-5-codex',
        providerID: 'openai',
        agent: 'OpenCode',
        path: { cwd: '/tmp/live' },
      }),
    );

    db.prepare(`
      INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'part-live-tool',
      'msg-live',
      'sess-live',
      now + 20,
      now + 20,
      JSON.stringify({
        type: 'tool',
        callID: 'tool-live',
        tool: 'bash',
        state: {
          status: 'pending',
          input: { command: 'pnpm build' },
        },
      }),
    );

    const events: UAEPEvent[] = [];
    const collector = new OpenCodeCollector({
      watchPaths: [dbPath, sessionsDir],
      tailOnly: true,
      pollIntervalMs: 25,
    });
    collector.onEvent((event) => events.push(event));

    try {
      await collector.start();

      db.prepare('UPDATE session SET time_updated = ? WHERE id = ?').run(now + 30, 'sess-live');
      db.prepare('UPDATE message SET time_updated = ? WHERE id = ?').run(now + 30, 'msg-live');
      db.prepare('UPDATE part SET time_updated = ?, data = ? WHERE id = ?').run(
        now + 30,
        JSON.stringify({
          type: 'tool',
          callID: 'tool-live',
          tool: 'bash',
          state: {
            status: 'pending',
            input: { command: 'pnpm build' },
          },
        }),
        'part-live-tool',
      );

      await waitFor(() => events.some((event) => event.type === 'tool.start' && event.span_id === 'tool-live'));

      db.prepare('UPDATE part SET time_updated = ?, data = ? WHERE id = ?').run(
        now + 60,
        JSON.stringify({
          type: 'tool',
          callID: 'tool-live',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'pnpm build' },
            output: 'Build complete',
          },
        }),
        'part-live-tool',
      );

      await waitFor(() => events.some((event) => event.type === 'tool.end' && event.span_id === 'tool-live'));
    } finally {
      await collector.stop();
    }

    expect(events.filter((event) => event.type === 'tool.start' && event.span_id === 'tool-live')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.end' && event.span_id === 'tool-live')).toHaveLength(1);
  });
});
