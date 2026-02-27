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
import { ClaudeCodeCollector, OpenClawCollector } from '@agent-observatory/collectors';
import type { Collector } from '@agent-observatory/collectors';
import { WebSocketTransport } from './transport.js';

const VERSION = '0.1.0';

const DEFAULT_WATCH_PATHS: Record<string, string> = {
  'claude-code': '~/.claude/projects',
  openclaw: '~/.openclaw/agents',
};

function createCollector(source: string, watchPaths: string[], tailOnly: boolean): Collector {
  switch (source) {
    case 'claude-code':
      return new ClaudeCodeCollector({ watchPaths, tailOnly });
    case 'openclaw':
      return new OpenClawCollector({ watchPaths, tailOnly });
    default:
      throw new Error(`Unknown source: ${source}. Supported: claude-code, openclaw`);
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
  .version(VERSION)
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
  .option('--tail-only', 'Skip existing files, collect new content only', true)
  .option('--no-tail-only', 'Process existing file content')
  .option('--batch-size <n>', 'Batch transmission size', '50')
  .option('--batch-interval <ms>', 'Batch transmission interval in ms', '1000')
  .action(async (opts) => {
    const source: string = opts.source;
    const serverUrl: string = opts.server;
    const apiKey: string | undefined = opts.apiKey;
    const tailOnly: boolean = opts.tailOnly;
    const batchSize = parsePositiveInt(opts.batchSize as string, '--batch-size');
    const batchIntervalMs = parsePositiveInt(opts.batchInterval as string, '--batch-interval');

    // Resolve watch paths
    const watchPaths = opts.watch
      ? (opts.watch as string).split(',').map((p: string) => p.trim())
      : [DEFAULT_WATCH_PATHS[source] ?? '.'];

    // Create collector first to validate source and obtain sourceType
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

    console.log(`[collector-cli] Starting ${source} collector`);
    console.log(`[collector-cli] Server: ${serverUrl}`);
    console.log(`[collector-cli] Watch paths: ${watchPaths.join(', ')}`);
    console.log(`[collector-cli] Tail-only: ${tailOnly}`);
    console.log(`[collector-cli] Collector ID: ${collectorId}`);

    // Create transport
    const transport = new WebSocketTransport({
      serverUrl,
      apiKey,
      registration,
      batchSize,
      batchIntervalMs,
    });

    // Wire collector events to transport
    collector.onEvent((event: UAEPEvent) => {
      transport.send(event);
    });

    // Connect transport then start collector
    transport.connect();
    await collector.start();

    console.log('[collector-cli] Running. Press Ctrl+C to stop.');

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n[collector-cli] Shutting down...');
      await collector.stop();
      transport.close();
      console.log('[collector-cli] Stopped.');
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.parse();
