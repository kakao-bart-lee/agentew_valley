import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import type { Server as HttpServer } from 'node:http';
import type { Express } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { InMemoryEventBus } from './core/event-bus.js';
import type { EventBus } from './core/event-bus.js';
import { StateManager } from './core/state-manager.js';
import { MetricsAggregator } from './core/metrics-aggregator.js';
import { HistoryStore } from './core/history-store.js';
import { HistoryStoreTaskContextProvider } from './core/task-context-provider.js';
import type { TaskContextProvider } from './core/task-context-provider.js';
import { PaperclipAdapter } from './core/paperclip-adapter.js';
import { createApiRouter } from './delivery/api.js';
import type { ApiConfig } from './delivery/api.js';
import { createAnalyticsRouter } from './delivery/api-analytics.js';
import { createOpenApiRouter } from './delivery/openapi.js';
import { createWebSocketServer } from './delivery/websocket.js';
import { createCollectorGateway } from './delivery/collector-gateway.js';
import type { CollectorGateway } from './delivery/collector-gateway.js';
import { createHooksRouter } from './delivery/hooks.js';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

export interface AppConfig {
  watchPaths?: string[];
  metricsIntervalMs?: number;
  timeseriesRetentionMinutes?: number;
  /** SQLite database file path. Defaults to :memory: */
  dbPath?: string;
  /** API keys for authenticating remote Collectors. Empty = open access. */
  collectorApiKeys?: string[];
  /** Optional API key for dashboard access. If set, frontend must provide Bearer token. */
  dashboardApiKey?: string;
}

export interface AppInstance {
  app: Express;
  server: HttpServer;
  io: SocketIOServer;
  eventBus: EventBus;
  stateManager: StateManager;
  metricsAggregator: MetricsAggregator;
  historyStore: HistoryStore;
  taskContextProvider: TaskContextProvider;
  collectorGateway: CollectorGateway;
  /** Gracefully close the app (DB connections, etc.) */
  close(): void;
}

export function createApp(config?: AppConfig): AppInstance {
  const eventBus = new InMemoryEventBus();
  const stateManager = new StateManager();
  const metricsAggregator = new MetricsAggregator();
  const historyStore = new HistoryStore(config?.dbPath);
  const taskContextProvider = new HistoryStoreTaskContextProvider(historyStore);

  metricsAggregator.setStateManager(stateManager);
  metricsAggregator.setDb(historyStore.getDb());

  eventBus.subscribe((event) => stateManager.handleEvent(event));
  eventBus.subscribe((event) => metricsAggregator.handleEvent(event));
  eventBus.subscribe((event) => historyStore.append(event));

  const app = express();
  app.use(cors());
  app.use(express.json());

  if (config?.dashboardApiKey) {
    console.info('[server] Dashboard API Key authentication enabled');
    app.use((req, res, next) => {
      if (req.method === 'OPTIONS') return next();
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
      }
      const token = authHeader.split(' ')[1];
      if (token !== config.dashboardApiKey) {
        return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      }
      next();
    });
  }

  // R-005: Paperclip Adapter — PAPERCLIP_API_URL 설정 시 활성화
  const paperclipAdapter = PaperclipAdapter.fromEnv();
  if (paperclipAdapter) {
    console.info(`[server] Paperclip Adapter enabled (${process.env['PAPERCLIP_API_URL']})`);
  }

  const apiConfig: ApiConfig = {
    watchPaths: config?.watchPaths ?? [],
    metricsIntervalMs: config?.metricsIntervalMs ?? 5000,
    timeseriesRetentionMinutes: config?.timeseriesRetentionMinutes ?? 60,
    taskContextProvider,
    paperclipAdapter: paperclipAdapter ?? undefined,
  };

  app.use(createApiRouter(stateManager, historyStore, metricsAggregator, eventBus, apiConfig));
  app.use(createAnalyticsRouter(historyStore));
  app.use(createOpenApiRouter());
  app.use(createHooksRouter(eventBus));

  const webDistPath = resolve(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    console.info(`[server] Serving static web files from ${webDistPath}`);
    app.use(express.static(webDistPath));
    app.get('/*path', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/') || req.path.startsWith('/collectors/')) {
        return next();
      }
      res.sendFile(resolve(webDistPath, 'index.html'));
    });
  }

  const server = createServer(app);
  const io = createWebSocketServer(server, stateManager, eventBus, metricsAggregator, config?.dashboardApiKey, historyStore);

  const collectorApiKeys = config?.collectorApiKeys ?? [];
  const collectorGateway = createCollectorGateway(io, eventBus, collectorApiKeys);

  app.get('/api/v1/collectors', (_req, res) => {
    const collectors = collectorGateway.getConnectedCollectors();
    res.json({ collectors, total: collectors.length });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  const close = () => {
    collectorGateway.close();
    historyStore.close();
  };

  return {
    app,
    server,
    io,
    eventBus,
    stateManager,
    metricsAggregator,
    historyStore,
    taskContextProvider,
    collectorGateway,
    close,
  };
}
