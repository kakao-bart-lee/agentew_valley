export { createApp } from './app.js';
export type { AppConfig, AppInstance } from './app.js';
export { InMemoryEventBus } from './core/event-bus.js';
export type { EventBus } from './core/event-bus.js';
export { StateManager } from './core/state-manager.js';
export { MetricsAggregator } from './core/metrics-aggregator.js';
export { HistoryStore } from './core/history-store.js';
export { createApiRouter } from './delivery/api.js';
export { createWebSocketServer } from './delivery/websocket.js';

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const watchPaths = (process.env.WATCH_PATHS ?? '').split(',').filter(Boolean);

  const { createApp } = await import('./app.js');
  const { server, eventBus } = createApp({ watchPaths });

  // Collectors integration (try to load, skip if not available)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const collectors = await (import('@agent-observatory/collectors' as any) as Promise<any>);
    if (collectors.ClaudeCodeCollector) {
      const ccPaths = (process.env.CLAUDE_CODE_WATCH_PATHS ?? '~/.claude/projects').split(',');
      const cc = new collectors.ClaudeCodeCollector({ watchPaths: ccPaths });
      cc.onEvent((event: unknown) => eventBus.publish(event as import('@agent-observatory/shared').UAEPEvent));
      await cc.start();
      console.log('[server] Claude Code collector started');
    }
  } catch {
    console.log('[server] Collectors not available, running without collectors');
  }

  server.listen(port, () => {
    console.log(`[server] Agent Observatory server listening on port ${port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[server] Shutting down...');
    server.close(() => {
      console.log('[server] Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
