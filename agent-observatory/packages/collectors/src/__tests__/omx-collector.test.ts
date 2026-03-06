import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OMXCollector } from '../omx/index.js';
import type { UAEPEvent } from '@agent-observatory/shared';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ao-omx-'));
  tempDirs.push(dir);
  return dir;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 25,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('OMXCollector', () => {
  it('emits events from existing OMX state and turn logs when tailOnly=false', async () => {
    const root = await makeTempDir();
    const logsDir = join(root, 'logs');
    const stateDir = join(root, 'state');
    await mkdir(logsDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    await writeFile(
      join(stateDir, 'session.json'),
      JSON.stringify({
        session_id: 'omx-demo-session',
        started_at: '2026-03-07T00:00:00.000Z',
        cwd: '/tmp/demo',
      }),
    );
    await writeFile(
      join(stateDir, 'team-state.json'),
      JSON.stringify({
        active: true,
        mode: 'team',
        team_name: 'demo-team',
      }),
    );
    await writeFile(
      join(logsDir, 'turns-2026-03-07.jsonl'),
      `${JSON.stringify({
        timestamp: '2026-03-07T00:00:01.000Z',
        type: 'agent-turn-complete',
        thread_id: 'thread-1',
        turn_id: 'turn-1',
        input_preview: 'hello',
        output_preview: 'world',
      })}\n`,
    );

    const events: UAEPEvent[] = [];
    const collector = new OMXCollector({ watchPaths: [root], tailOnly: false });
    collector.onEvent((event) => events.push(event));

    try {
      await collector.start();
      await waitFor(() => events.length >= 4);
    } finally {
      await collector.stop();
    }

    expect(events.some((event) => event.source === 'omx')).toBe(true);
    expect(events.some((event) => event.type === 'session.start')).toBe(true);
    expect(events.some((event) => event.type === 'agent.status')).toBe(true);
    expect(events.some((event) => event.type === 'user.input')).toBe(true);
    expect(events.some((event) => event.type === 'llm.end')).toBe(true);
  });
});
