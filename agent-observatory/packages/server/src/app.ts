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
import { ResumePushHook, readResumePushConfigFromEnv } from './delivery/resume-push.js';

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
  /**
   * Startup replay: DB에서 이 시각 이후 이벤트를 StateManager/MetricsAggregator에 재주입.
   * 기본값: 서버 시작 시각 기준 24시간 전 (ISO-8601 문자열 또는 "Nh" 형식).
   * 비활성화하려면 빈 문자열("") 전달.
   */
  replayWindowHours?: number;
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
  resumePushHook: ResumePushHook | null;
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

  // Startup replay: DB의 최근 이벤트를 StateManager/MetricsAggregator에 재주입
  // historyStore.append()는 호출하지 않아 DB 중복 저장 없음
  const replayWindowHours = config?.replayWindowHours ?? 24;
  if (replayWindowHours > 0 && config?.dbPath) {
    const sinceTs = new Date(Date.now() - replayWindowHours * 3_600_000).toISOString();
    const replayEvents = historyStore.getEventsSince(sinceTs);
    for (const event of replayEvents) {
      stateManager.handleEvent(event);
      metricsAggregator.handleEvent(event);
    }
    if (replayEvents.length > 0) {
      console.info(`[server] Startup replay: ${replayEvents.length} events (last ${replayWindowHours}h) → StateManager + MetricsAggregator`);
    }
  }

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

  // Resume push hook 등록
  const resumePushConfig = readResumePushConfigFromEnv();
  let resumePushHook: ResumePushHook | null = null;
  if (resumePushConfig) {
    resumePushHook = new ResumePushHook({
      ...resumePushConfig,
      db: historyStore.getDb(),
    });
    resumePushHook.start(eventBus);
    const targetUrls = resumePushConfig.targets.map((t) => t.label ?? t.url).join(", ");
    console.info(`[server] Resume push enabled → ${targetUrls} (${resumePushConfig.intervalMs ?? 300_000}ms interval)`);

    // POST /api/v1/resume/sync — 수동 full sync 트리거
    app.post('/api/v1/resume/sync', (_req, res) => {
      if (!resumePushHook) {
        return res.status(503).json({ error: 'Resume push not configured', code: 'RESUME_PUSH_DISABLED' });
      }
      // 비동기 실행 — 결과는 로그로 확인
      void resumePushHook.fullSync().then((result) => {
        if (!result.ok) {
          console.error(`[resume-push] Manual sync failed: ${result.error ?? 'unknown'}`);
        }
      });
      return res.json({ ok: true, message: 'Full sync started' });
    });

    // GET /api/v1/resume/status
    app.get('/api/v1/resume/status', (_req, res) => {
      if (!resumePushHook) {
        return res.status(503).json({ error: 'Resume push not configured', code: 'RESUME_PUSH_DISABLED' });
      }
      return res.json({ enabled: true, ...resumePushHook.status() });
    });
  }

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });

  const close = () => {
    resumePushHook?.stop();
    stateManager.destroy();
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
    resumePushHook,
    close,
  };
}
