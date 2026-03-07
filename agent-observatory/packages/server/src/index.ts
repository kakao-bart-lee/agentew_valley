export { createApp } from './app.js';
export type { AppConfig, AppInstance } from './app.js';
export { InMemoryEventBus } from './core/event-bus.js';
export type { EventBus } from './core/event-bus.js';
export { StateManager } from './core/state-manager.js';
export { MetricsAggregator } from './core/metrics-aggregator.js';
export { HistoryStore } from './core/history-store.js';
export { HistoryStoreTaskContextProvider } from './core/task-context-provider.js';
export type { TaskContextProvider } from './core/task-context-provider.js';
export { createApiRouter } from './delivery/api.js';
export { createWebSocketServer } from './delivery/websocket.js';
export { createCollectorGateway } from './delivery/collector-gateway.js';
export type { CollectorGateway } from './delivery/collector-gateway.js';

import type { UAEPEvent } from '@agent-observatory/shared';
import type { Collector } from '@agent-observatory/collectors';
import {
  AgentSDKCollector,
  ClaudeCodeCollector,
  HTTPCollector,
  OMXCollector,
  OpenClawCollector,
  OpenCodeCollector,
} from '@agent-observatory/collectors';
import { createApp } from './app.js';

type ObservatoryMode = 'local' | 'remote';

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3561', 10);
  const watchPaths = (process.env.WATCH_PATHS ?? '').split(',').filter(Boolean);
  const dbPath = process.env.OBSERVATORY_DB_PATH ?? undefined;
  const tailOnly = process.env.OBSERVATORY_TAIL_ONLY !== 'false';
  const mode: ObservatoryMode = (process.env.OBSERVATORY_MODE as ObservatoryMode) ?? 'local';
  const collectorApiKeys = (process.env.OBSERVATORY_COLLECTOR_API_KEYS ?? '').split(',').filter(Boolean);
  const dashboardApiKey = process.env.OBSERVATORY_DASHBOARD_API_KEY || undefined;

  const { app, server, eventBus, close } = createApp({
    watchPaths,
    dbPath,
    collectorApiKeys,
    dashboardApiKey,
  });

  const activeCollectors: Collector[] = [];

  if (mode === 'local') {
    try {
      const ccPaths = (process.env.CLAUDE_CODE_WATCH_PATHS ?? '~/.claude/projects').split(',');
      const cc = new ClaudeCodeCollector({ watchPaths: ccPaths, tailOnly });
      cc.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await cc.start();
      activeCollectors.push(cc);
      console.log(`[server] Claude Code collector started (paths: ${ccPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] Claude Code collector failed to start:', err);
    }

    try {
      const ocPaths = (process.env.OPENCLAW_WATCH_PATHS ?? '~/.openclaw/agents').split(',');
      const oc = new OpenClawCollector({ watchPaths: ocPaths, tailOnly });
      oc.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await oc.start();
      activeCollectors.push(oc);
      console.log(`[server] OpenClaw collector started (paths: ${ocPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] OpenClaw collector failed to start:', err);
    }

    try {
      const omxPaths = (process.env.OMX_WATCH_PATHS ?? '.omx').split(',');
      const omx = new OMXCollector({ watchPaths: omxPaths, tailOnly });
      omx.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await omx.start();
      activeCollectors.push(omx);
      console.log(`[server] OMX collector started (paths: ${omxPaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] OMX collector failed to start:', err);
    }

    try {
      const opencodePaths = (process.env.OPENCODE_WATCH_PATHS ?? '~/.local/share/opencode,~/.openclaw/agents/opencode/sessions').split(',');
      const opencode = new OpenCodeCollector({
        watchPaths: opencodePaths,
        tailOnly,
        dbPath: process.env.OPENCODE_DB_PATH ?? undefined,
        sessionsIndexPath: process.env.OPENCODE_SESSIONS_INDEX_PATH ?? undefined,
      });
      opencode.onEvent((event: UAEPEvent) => eventBus.publish(event));
      await opencode.start();
      activeCollectors.push(opencode);
      console.log(`[server] OpenCode collector started (paths: ${opencodePaths.join(', ')})`);
    } catch (err) {
      console.warn('[server] OpenCode collector failed to start:', err);
    }

    const sdkCollector = new AgentSDKCollector();
    sdkCollector.onEvent((event: UAEPEvent) => eventBus.publish(event));
    app.use(sdkCollector.getRouter());
    activeCollectors.push(sdkCollector);
    console.log('[server] Agent SDK hook collector mounted');

    const apiKeys = (process.env.OBSERVATORY_API_KEYS ?? '').split(',').filter(Boolean);
    const httpCollector = new HTTPCollector({ apiKeys: apiKeys.length > 0 ? apiKeys : undefined });
    httpCollector.onEvent((event: UAEPEvent) => eventBus.publish(event));
    app.use(httpCollector.getRouter());
    activeCollectors.push(httpCollector);
    console.log(`[server] HTTP collector mounted (API keys: ${apiKeys.length > 0 ? `${apiKeys.length} configured` : 'open access'})`);
  } else {
    console.log('[server] Remote mode — local collectors disabled, WebSocket gateway active');
  }

  if (mode === 'local' && activeCollectors.length === 0) {
    console.log('[server] No collectors active — running in API-only mode');
  }

  server.listen(port, () => {
    console.log(`[server] Agent Observatory server listening on port ${port}`);
    console.log(`[server] Mode: ${mode}`);
    if (mode === 'local') {
      console.log(`[server] Active collectors: ${activeCollectors.map((collector) => collector.name).join(', ') || 'none'}`);
      console.log(`[server] Tail-only mode: ${tailOnly ? 'ON (skip existing, collect new only)' : 'OFF (read all existing files)'}`);
    }
    if (collectorApiKeys.length > 0) {
      console.log(`[server] Collector Gateway: ${collectorApiKeys.length} API key(s) configured`);
    } else {
      console.log('[server] Collector Gateway: open access (no API keys)');
    }
    if (dbPath) {
      console.log(`[server] SQLite database: ${dbPath}`);
    } else {
      console.log('[server] SQLite database: in-memory (data will not persist across restarts)');
    }
  });

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
    close();
    server.close(() => {
      console.log('[server] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const isMain =
  process.argv[1]
  && (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/index.ts'));

if (isMain) {
  main().catch((err) => {
    console.error('[server] Fatal error:', err);
    process.exit(1);
  });
}
