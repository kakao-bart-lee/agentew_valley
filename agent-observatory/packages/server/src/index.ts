export { createApp } from './app.js';
export type { AppConfig, AppInstance } from './app.js';
export { InMemoryEventBus } from './core/event-bus.js';
export type { EventBus } from './core/event-bus.js';
export { StateManager } from './core/state-manager.js';
export { MetricsAggregator } from './core/metrics-aggregator.js';
export { HistoryStore } from './core/history-store.js';
export { createApiRouter } from './delivery/api.js';
export { createWebSocketServer } from './delivery/websocket.js';

import type { UAEPEvent } from '@agent-observatory/shared';
import type { Collector } from '@agent-observatory/collectors';
import { ClaudeCodeCollector, OpenClawCollector } from '@agent-observatory/collectors';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const watchPaths = (process.env.WATCH_PATHS ?? '').split(',').filter(Boolean);

  const { server, eventBus } = createApp({ watchPaths });

  const activeCollectors: Collector[] = [];

  // Claude Code Collector
  try {
    const ccPaths = (process.env.CLAUDE_CODE_WATCH_PATHS ?? '~/.claude/projects').split(',');
    const cc = new ClaudeCodeCollector({ watchPaths: ccPaths });
    cc.onEvent((event: UAEPEvent) => eventBus.publish(event));
    await cc.start();
    activeCollectors.push(cc);
    console.log(`[server] Claude Code collector started (paths: ${ccPaths.join(', ')})`);
  } catch (err) {
    console.warn('[server] Claude Code collector failed to start:', err);
  }

  // OpenClaw Collector
  try {
    const ocPaths = (process.env.OPENCLAW_WATCH_PATHS ?? '~/.openclaw/agents').split(',');
    const oc = new OpenClawCollector({ watchPaths: ocPaths });
    oc.onEvent((event: UAEPEvent) => eventBus.publish(event));
    await oc.start();
    activeCollectors.push(oc);
    console.log(`[server] OpenClaw collector started (paths: ${ocPaths.join(', ')})`);
  } catch (err) {
    console.warn('[server] OpenClaw collector failed to start:', err);
  }

  if (activeCollectors.length === 0) {
    console.log('[server] No collectors active — running in API-only mode');
  }

  server.listen(port, () => {
    console.log(`[server] Agent Observatory server listening on port ${port}`);
    console.log(`[server] Active collectors: ${activeCollectors.map(c => c.name).join(', ') || 'none'}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[server] Shutting down...');
    for (const collector of activeCollectors) {
      try {
        await collector.stop();
        console.log(`[server] Collector ${collector.name} stopped`);
      } catch (err) {
        console.warn(`[server] Error stopping collector ${collector.name}:`, err);
      }
    }
    server.close(() => {
      console.log('[server] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

// Run only when executed directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/index.js') ||
    process.argv[1].endsWith('/index.ts'));

if (isMain) {
  main().catch((err) => {
    console.error('[server] Fatal error:', err);
    process.exit(1);
  });
}
