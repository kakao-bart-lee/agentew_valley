import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ClaudeCodeWatcher } from '../claude-code/watcher.js';
import { MissionControlWatcher } from '../mission-control/watcher.js';
import { OpenClawWatcher } from '../openclaw/watcher.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ao-watcher-'));
  tempDirs.push(dir);
  return dir;
}

describe('watcher backfill', () => {
  it('ClaudeCodeWatcher ingests existing nested jsonl files when tailOnly=false', async () => {
    const root = await makeTempDir();
    const nested = join(root, 'project-a', 'session-1');
    await mkdir(nested, { recursive: true });
    const filePath = join(nested, 'existing.jsonl');
    await writeFile(
      filePath,
      await readFile(join(FIXTURES, 'claude-code-sample.jsonl'), 'utf-8'),
    );

    const seen: Array<{ filePath: string; records: unknown[]; isNewFile: boolean }> = [];
    const watcher = new ClaudeCodeWatcher({ watchPaths: [root], tailOnly: false });
    watcher.onRecords((observedPath, records, isNewFile) => {
      seen.push({ filePath: observedPath, records, isNewFile });
    });

    try {
      await watcher.start();
      await waitFor(() => seen.length > 0);
    } finally {
      await watcher.stop();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].filePath).toBe(filePath);
    expect(seen[0].isNewFile).toBe(true);
    expect(seen[0].records.length).toBeGreaterThan(0);
  });

  it('ClaudeCodeWatcher preserves tailOnly=true for pre-existing files', async () => {
    const root = await makeTempDir();
    const nested = join(root, 'project-a', 'session-1');
    await mkdir(nested, { recursive: true });
    const filePath = join(nested, 'existing.jsonl');
    const fixture = await readFile(join(FIXTURES, 'claude-code-sample.jsonl'), 'utf-8');
    await writeFile(filePath, fixture);

    const seen: Array<{ records: unknown[]; isNewFile: boolean }> = [];
    const watcher = new ClaudeCodeWatcher({ watchPaths: [root], tailOnly: true });
    watcher.onRecords((_observedPath, records, isNewFile) => {
      seen.push({ records, isNewFile });
    });

    try {
      await watcher.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(seen).toHaveLength(0);

      await writeFile(filePath, `${fixture}${fixture}`);
      await waitFor(() => seen.length > 0);
    } finally {
      await watcher.stop();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].isNewFile).toBe(false);
    expect(seen[0].records.length).toBeGreaterThan(0);
  });

  it('OpenClawWatcher ingests existing nested jsonl files when tailOnly=false', async () => {
    const root = await makeTempDir();
    const nested = join(root, 'agent-a', 'sessions');
    await mkdir(nested, { recursive: true });
    const filePath = join(nested, 'existing.jsonl');
    await writeFile(
      filePath,
      await readFile(join(FIXTURES, 'openclaw-sample.jsonl'), 'utf-8'),
    );

    const seen: Array<{ filePath: string; records: unknown[]; isNewFile: boolean }> = [];
    const watcher = new OpenClawWatcher({ watchPaths: [root], tailOnly: false });
    watcher.onRecords((observedPath, records, isNewFile) => {
      seen.push({ filePath: observedPath, records, isNewFile });
    });

    try {
      await watcher.start();
      await waitFor(() => seen.length > 0);
    } finally {
      await watcher.stop();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].filePath).toBe(filePath);
    expect(seen[0].isNewFile).toBe(true);
    expect(seen[0].records.length).toBeGreaterThan(0);
  });

  it('OpenClawWatcher preserves tailOnly=true for pre-existing files', async () => {
    const root = await makeTempDir();
    const nested = join(root, 'agent-a', 'sessions');
    await mkdir(nested, { recursive: true });
    const filePath = join(nested, 'existing.jsonl');
    const fixture = await readFile(join(FIXTURES, 'openclaw-sample.jsonl'), 'utf-8');
    await writeFile(filePath, fixture);

    const seen: Array<{ records: unknown[]; isNewFile: boolean }> = [];
    const watcher = new OpenClawWatcher({ watchPaths: [root], tailOnly: true });
    watcher.onRecords((_observedPath, records, isNewFile) => {
      seen.push({ records, isNewFile });
    });

    try {
      await watcher.start();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(seen).toHaveLength(0);

      await writeFile(filePath, `${fixture}${fixture}`);
      await waitFor(() => seen.length > 0);
    } finally {
      await watcher.stop();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].isNewFile).toBe(false);
    expect(seen[0].records.length).toBeGreaterThan(0);
  });

  it('MissionControlWatcher ingests existing TASK.md files on initial scan', async () => {
    const root = await makeTempDir();
    const nested = join(root, 'workspace-a');
    await mkdir(nested, { recursive: true });
    const filePath = join(nested, 'TASK.md');
    await writeFile(
      filePath,
      [
        '### T-001: (moonlit) Initial watcher sync #high',
        '- Owner: frontend',
        '- Status: inbox',
        '- Goal ID: G-001',
        '- Goal (1 sentence): Verify initial scan.',
        '',
      ].join('\n'),
    );

    const snapshots: Array<{ tasks: Array<{ id: string }> }> = [];
    const watcher = new MissionControlWatcher([root]);
    watcher.onSnapshot((snapshot) => {
      snapshots.push(snapshot as { tasks: Array<{ id: string }> });
    });

    try {
      await watcher.start();
      await waitFor(() => snapshots.some((snapshot) => snapshot.tasks.length > 0));
    } finally {
      await watcher.stop();
    }

    const snapshot = snapshots.find((entry) => entry.tasks.length > 0);
    expect(snapshot?.tasks[0]?.id).toBe('T-001');
  });
});
