import express from 'express';
import { createServer } from 'node:http';
import cors from 'cors';
import type { Server as HttpServer } from 'node:http';
import type { Express } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { InMemoryEventBus } from './core/event-bus.js';
import type { EventBus } from './core/event-bus.js';
import { StateManager } from './core/state-manager.js';
import { MetricsAggregator } from './core/metrics-aggregator.js';
import { HistoryStore } from './core/history-store.js';
import { createApiRouter } from './delivery/api.js';
import type { ApiConfig } from './delivery/api.js';
import { createAnalyticsRouter } from './delivery/api-analytics.js';
import { createOpenApiRouter } from './delivery/openapi.js';
import { createWebSocketServer } from './delivery/websocket.js';
import { createCollectorGateway } from './delivery/collector-gateway.js';
import type { CollectorGateway } from './delivery/collector-gateway.js';

export interface AppConfig {
  watchPaths?: string[];
  metricsIntervalMs?: number;
  timeseriesRetentionMinutes?: number;
  /** SQLite database file path. Defaults to :memory: */
  dbPath?: string;
  /** API keys for authenticating remote Collectors. Empty = open access. */
  collectorApiKeys?: string[];
}

export interface AppInstance {
  app: Express;
  server: HttpServer;
  io: SocketIOServer;
  eventBus: EventBus;
  stateManager: StateManager;
  metricsAggregator: MetricsAggregator;
  historyStore: HistoryStore;
  collectorGateway: CollectorGateway;
  /** Gracefully close the app (DB connections, etc.) */
  close(): void;
}

export function createApp(config?: AppConfig): AppInstance {
  // 1. Core modules
  const eventBus = new InMemoryEventBus();
  const stateManager = new StateManager();
  const metricsAggregator = new MetricsAggregator();
  const historyStore = new HistoryStore(config?.dbPath);

  metricsAggregator.setStateManager(stateManager);
  metricsAggregator.setDb(historyStore.getDb());

  // 2. EventBus subscriptions
  eventBus.subscribe((event) => stateManager.handleEvent(event));
  eventBus.subscribe((event) => metricsAggregator.handleEvent(event));
  eventBus.subscribe((event) => historyStore.append(event));

  // 3. Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  const apiConfig: ApiConfig = {
    watchPaths: config?.watchPaths ?? [],
    metricsIntervalMs: config?.metricsIntervalMs ?? 5000,
    timeseriesRetentionMinutes: config?.timeseriesRetentionMinutes ?? 60,
  };
  app.use(createApiRouter(stateManager, historyStore, metricsAggregator, eventBus, apiConfig));
  app.use(createAnalyticsRouter(historyStore));
  app.use(createOpenApiRouter());

  // 4. HTTP + WebSocket
  const server = createServer(app);
  const io = createWebSocketServer(server, stateManager, eventBus, metricsAggregator);

  // 5. Collector WebSocket Gateway (/collectors namespace)
  const collectorApiKeys = config?.collectorApiKeys ?? [];
  const collectorGateway = createCollectorGateway(io, eventBus, collectorApiKeys);

  // 6. Collector REST endpoint — registered after gateway creation
  app.get('/api/v1/collectors', (_req, res) => {
    const collectors = collectorGateway.getConnectedCollectors();
    res.json({ collectors, total: collectors.length });
  });

  // Error handler — must be last
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error('[server] Unhandled error:', err.message);
      res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    },
  );

  // 7. Graceful close
  const close = () => {
    collectorGateway.close();
    historyStore.close();
  };

  return { app, server, io, eventBus, stateManager, metricsAggregator, historyStore, collectorGateway, close };
}
