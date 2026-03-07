#!/usr/bin/env node

/**
 * observatory-collector CLI
 *
 * 독립 프로세스로 실행되는 Collector. 에이전트 머신에서 JSONL을 감시하고,
 * WebSocket을 통해 원격 Observatory 서버에 이벤트를 Push한다.
 *
 * Usage:
 *   observatory-collector \
 *     --server wss://observatory.example.com \
 *     --api-key <key> \
 *     --source claude-code \
 *     --watch ~/.claude/projects
 */

import { Command } from 'commander';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { UAEPEvent, CollectorRegistration } from '@agent-observatory/shared';
import {
  ClaudeCodeCollector,
  OpenClawCollector,
  OpenCodeCollector,
  CodexCollector,
  OMXCollector,
  Pm2Collector,
} from '@agent-observatory/collectors';
import type { Collector } from '@agent-observatory/collectors';
import { WebSocketTransport } from './transport.js';
import { persistEvent, readPersistedEvents } from './persistence.js';

const VERSION = '0.2.0';

const DEFAULT_WATCH_PATHS: Record<string, string> = {
  'claude-code': '~/.claude/projects',
  openclaw: '~/.openclaw/agents',
  opencode: '~/.opencode/logs',
  codex: '~/.codex/logs',
};

function createCollector(source: string, watchPaths: string[], tailOnly: boolean): Collector {
  switch (source) {
    case 'claude-code':
      return new ClaudeCodeCollector({ watchPaths, tailOnly });
    case 'openclaw':
      return new OpenClawCollector({ watchPaths, tailOnly });
    case 'opencode':
      return new OpenCodeCollector({ watchPaths, tailOnly });
    case 'codex':
      return new CodexCollector({ watchPaths, tailOnly });
    case 'omx':
      return new OMXCollector({ watchPaths, tailOnly });
    case 'pm2':
      return new Pm2Collector();
    default:
      throw new Error(
        `Unknown source: ${source}. Supported: claude-code, openclaw, opencode, codex, omx, pm2`,
      );
  }
}

function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) {
    console.error(`[collector-cli] Invalid ${name}: ${value} (must be a positive integer)`);
    process.exit(1);
  }
  return n;
}

const program = new Command();

program
  .name('observatory-collector')
  .description('Remote collector CLI for Agent Observatory')
  .version(VERSION);

/**
 * [Subcommand] run (Default) — Real-time collection
 */
program
  .command('run', { isDefault: true })
  .description('Collect and push agent events in real-time')
  .requiredOption(
    '-s, --server <url>',
    'Observatory server WebSocket URL',
    process.env.OBSERVATORY_SERVER,
  )
  .option(
    '-k, --api-key <key>',
    'API key for server authentication',
    process.env.OBSERVATORY_API_KEY,
  )
  .requiredOption(
    '--source <type>',
    'Collector source type (claude-code, openclaw)',
    process.env.OBSERVATORY_SOURCE,
  )
  .option(
    '-w, --watch <paths>',
    'Watch paths (comma-separated)',
    process.env.OBSERVATORY_WATCH_PATHS,
  )
  .option('--persist <file>', 'Persist collected events to a local JSONL file')
  .option('--offline', 'Collect and persist only, do not send to server', false)
  .option('--tail-only', 'Skip existing files, collect new content only', true)
  .option('--no-tail-only', 'Process existing file content')
  .option('--batch-size <n>', 'Batch transmission size', '50')
  .option('--batch-interval <ms>', 'Batch transmission interval in ms', '1000')
  .action(async (opts) => {
    const source: string = opts.source;
    const serverUrl: string = opts.server;
    const apiKey: string | undefined = opts.apiKey;
    const tailOnly: boolean = opts.tailOnly;
    const offline: boolean = opts.offline;
    const persistPath: string | undefined = opts.persist;
    const batchSize = parsePositiveInt(opts.batchSize as string, '--batch-size');
    const batchIntervalMs = parsePositiveInt(opts.batchInterval as string, '--batch-interval');

    // Resolve watch paths
    const watchPaths = opts.watch
      ? (opts.watch as string).split(',').map((p: string) => p.trim())
      : [DEFAULT_WATCH_PATHS[source] ?? '.'];

    // Create collector
    let collector: Collector;
    try {
      collector = createCollector(source, watchPaths, tailOnly);
    } catch (err) {
      console.error(`[collector-cli] ${(err as Error).message}`);
      process.exit(1);
    }

    const collectorId = randomUUID();
    const registration: CollectorRegistration = {
      collector_id: collectorId,
      name: source,
      source_type: collector.sourceType,
      machine_id: hostname(),
      watch_paths: watchPaths,
      version: VERSION,
    };

    console.log(`[collector-cli] Starting ${source} collector (mode: ${offline ? 'offline' : 'online'})`);
    if (!offline) console.log(`[collector-cli] Server: ${serverUrl}`);
    if (persistPath) console.log(`[collector-cli] Persisting to: ${persistPath}`);
    console.log(`[collector-cli] Watch paths: ${watchPaths.join(', ')}`);
    console.log(`[collector-cli] Collector ID: ${collectorId}`);

    // Create transport (if not offline)
    const transport = !offline
      ? new WebSocketTransport({
          serverUrl,
          apiKey,
          registration,
          batchSize,
          batchIntervalMs,
        })
      : null;

    // Wire collector events
    collector.onEvent((event: UAEPEvent) => {
      if (persistPath) {
        persistEvent(persistPath, event);
      }
      if (transport) {
        transport.send(event);
      }
    });

    // Connect transport then start collector
    if (transport) transport.connect();
    await collector.start();

    console.log('[collector-cli] Running. Press Ctrl+C to stop.');

    const shutdown = async () => {
      console.log('\n[collector-cli] Shutting down...');
      await collector.stop();
      if (transport) transport.close();
      console.log('[collector-cli] Stopped.');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

/**
 * [Subcommand] sync — Push persisted log to server
 */
program
  .command('sync')
  .description('Push persisted UAEP log file to Observatory server')
  .requiredOption('-f, --file <path>', 'JSONL log file path to sync')
  .requiredOption(
    '-s, --server <url>',
    'Observatory server WebSocket URL',
    process.env.OBSERVATORY_SERVER,
  )
  .option(
    '-k, --api-key <key>',
    'API key for server authentication',
    process.env.OBSERVATORY_API_KEY,
  )
  .option('--batch-size <n>', 'Batch transmission size', '100')
  .action(async (opts) => {
    const filePath: string = opts.file;
    const serverUrl: string = opts.server;
    const apiKey: string | undefined = opts.apiKey;
    const batchSize = parsePositiveInt(opts.batchSize as string, '--batch-size');

    console.log(`[collector-cli] Syncing log: ${filePath}`);
    console.log(`[collector-cli] Target Server: ${serverUrl}`);

    const registration: CollectorRegistration = {
      collector_id: `sync-${randomUUID().slice(0, 8)}`,
      name: 'sync-tool',
      source_type: 'agent_sdk', // Generic type for sync
      machine_id: hostname(),
      watch_paths: [filePath],
      version: VERSION,
    };

    const transport = new WebSocketTransport({
      serverUrl,
      apiKey,
      registration,
      batchSize,
      batchIntervalMs: 500, // Faster batching for sync
    });

    transport.connect();

    // Wait for registration
    console.log('[collector-cli] Connecting to server...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    let count = 0;
    for await (const event of readPersistedEvents(filePath)) {
      transport.send(event);
      count++;
      if (count % 500 === 0) {
        console.log(`[collector-cli] Queued ${count} events...`);
      }
    }

    console.log(`[collector-cli] Finished reading ${count} events. Waiting for transport to drain...`);

    // Wait for drain (simple timeout for now, can be improved with event listeners)
    const waitDrain = async () => {
      while (transport.bufferedCount > 0) {
        process.stdout.write(`\r[collector-cli] Remaining in buffer: ${transport.bufferedCount}   `);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      process.stdout.write('\n');
    };

    await waitDrain();
    console.log('[collector-cli] Sync complete.');
    transport.close();
    process.exit(0);
  });

program.parse();

