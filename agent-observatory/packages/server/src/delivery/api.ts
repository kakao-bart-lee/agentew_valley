import { Router } from 'express';
import type { Response } from 'express';
import type { StateManager } from '../core/state-manager.js';
import type { HistoryStore } from '../core/history-store.js';
import type { MetricsAggregator } from '../core/metrics-aggregator.js';
import type { EventBus } from '../core/event-bus.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_ENV_VARS,
  isAuthV2Enabled,
  isKillSwitchAllV2Enabled,
  isTasksV2Enabled,
  isWebhooksV2Enabled,
} from '../config/feature-flags.js';
import type { FeatureFlags, FeatureFlagName } from '../config/feature-flags.js';
import type { getMcDb as GetMcDb } from '../lib/mc-db.js';

export interface ApiConfig {
  watchPaths: string[];
  metricsIntervalMs: number;
  timeseriesRetentionMinutes: number;
  shadowModeEnabled: boolean;
  shadowModeReadOnly: boolean;
  shadowReportProvider: ShadowReportProvider;
  featureFlags: FeatureFlags;
  /** Accessor for Mission Control SQLite DB (may return null if not configured) */
  getMcDb?: () => ReturnType<typeof GetMcDb>;
}

export interface ShadowReportTopDiff {
  entity: string;
  path: string;
  count: number;
}

export interface ShadowReport {
  passCount: number;
  failCount: number;
  topDiffs: ShadowReportTopDiff[];
}

export type ShadowReportProvider = () => ShadowReport;

const defaultShadowReportProvider: ShadowReportProvider = () => ({
  passCount: 0,
  failCount: 0,
  topDiffs: [],
});

const DEFAULT_CONFIG: ApiConfig = {
  watchPaths: [],
  metricsIntervalMs: 5000,
  timeseriesRetentionMinutes: 60,
  shadowModeEnabled: false,
  shadowModeReadOnly: true,
  shadowReportProvider: defaultShadowReportProvider,
  featureFlags: { ...DEFAULT_FEATURE_FLAGS },
};

function sendFeatureFlagDisabled(
  featureFlag: 'auth_v2' | 'tasks_v2' | 'webhooks_v2',
  res: Response,
): void {
  res.status(503).json({
    error: 'Requested v2 domain is disabled by feature flag',
    code: 'FEATURE_FLAG_DISABLED',
    feature_flag: featureFlag,
  });
}

function sendV2KillSwitchEnabled(res: Response): void {
  res.status(503).json({
    error: 'All v2 routes are disabled by global kill switch',
    code: 'V2_KILL_SWITCH_ENABLED',
    reason: 'kill_switch_all_v2',
  });
}

export function createApiRouter(
  stateManager: StateManager,
  historyStore: HistoryStore,
  metricsAggregator: MetricsAggregator,
  eventBus: EventBus,
  config: ApiConfig = DEFAULT_CONFIG,
): Router {
  const router = Router();

  // GET /api/v1/agents
  router.get('/api/v1/agents', (_req, res) => {
    const agents = stateManager.getAllAgents();
    res.json({ agents, total: agents.length });
  });

  // GET /api/v1/agents/hierarchy (must be before :id route)
  router.get('/api/v1/agents/hierarchy', (_req, res) => {
    const hierarchy = stateManager.getHierarchy();
    res.json({ hierarchy });
  });

  // GET /api/v1/agents/by-team (must be before :id route)
  router.get('/api/v1/agents/by-team', (_req, res) => {
    const teams = stateManager.getTeams();
    res.json({ teams });
  });

  // GET /api/v1/agents/:id
  router.get('/api/v1/agents/:id', (req, res) => {
    const agent = stateManager.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' });
      return;
    }
    res.json({ agent });
  });

  // GET /api/v1/agents/:id/events
  router.get('/api/v1/agents/:id/events', (req, res) => {
    const agentId = req.params.id;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const type = req.query.type as string | undefined;

    const events = historyStore.getByAgent(agentId, { limit, offset, type });
    const total = historyStore.getAgentEventCount(agentId);

    res.json({ events, total, offset, limit });
  });

  // GET /api/v1/sessions
  router.get('/api/v1/sessions', (_req, res) => {
    const rows = historyStore.getSessionSummaries();
    const sessions = rows.map((r) => ({
      session_id: r.session_id,
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      source: r.source,
      team_id: r.team_id ?? undefined,
      start_time: r.start_time,
      end_time: r.end_time ?? undefined,
      total_events: r.total_events,
      total_tokens: r.total_tokens,
      total_cost_usd: r.total_cost_usd,
    }));
    res.json({ sessions, total: sessions.length });
  });

  // GET /api/v1/sessions/:id
  router.get('/api/v1/sessions/:id', (req, res) => {
    const sessionId = req.params.id;
    const session = historyStore.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }
    const events = historyStore.getBySession(sessionId);
    res.json({ session_id: sessionId, events, total: events.length });
  });

  // GET /api/v1/sessions/:id/replay
  router.get('/api/v1/sessions/:id/replay', (req, res) => {
    const sessionId = req.params.id;
    const session = historyStore.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
      return;
    }

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const typesParam = req.query.types as string | undefined;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset !== undefined ? parseInt(req.query.offset as string, 10) : undefined;
    const types = typesParam ? typesParam.split(',').map((t) => t.trim()) : undefined;

    const events = historyStore.getSessionReplay(sessionId, { from, to, types, limit, offset });
    const eventTypeCounts = historyStore.getSessionEventTypeCounts(sessionId);
    const toolCallCount = historyStore.getSessionToolCallCount(sessionId);

    // Compute gap_ms and offset_ms
    const sessionStartMs = new Date(session.start_time).getTime();
    let prevMs = sessionStartMs;

    const replayEvents = events.map((event) => {
      const eventMs = new Date(event.ts).getTime();
      const gap_ms = eventMs - prevMs;
      const offset_ms = eventMs - sessionStartMs;
      prevMs = eventMs;
      return { event, gap_ms, offset_ms };
    });

    const endTime = session.end_time ?? events[events.length - 1]?.ts ?? session.start_time;
    const duration_ms = new Date(endTime).getTime() - sessionStartMs;

    const summary = {
      agent_id: session.agent_id,
      agent_name: session.agent_name,
      source: session.source,
      team_id: session.team_id ?? undefined,
      start_time: session.start_time,
      end_time: session.end_time ?? undefined,
      duration_ms,
      total_events: session.total_events,
      total_tokens: session.total_tokens,
      total_cost_usd: session.total_cost_usd,
      total_tool_calls: toolCallCount,
      event_type_counts: eventTypeCounts,
    };

    const response: Record<string, unknown> = {
      session_id: sessionId,
      summary,
      events: replayEvents,
      total_events: session.total_events,
    };

    if (from || to) {
      response.time_range = { from: from ?? session.start_time, to: to ?? endTime };
    }

    res.json(response);
  });

  // GET /api/v1/metrics/summary
  router.get('/api/v1/metrics/summary', (_req, res) => {
    const metrics = metricsAggregator.getSnapshot();
    res.json({ metrics });
  });

  // GET /api/v1/metrics/timeseries
  router.get('/api/v1/metrics/timeseries', (req, res) => {
    const metric = (req.query.metric as string) ?? 'tokens_per_minute';
    const from = parseInt(req.query.from as string, 10) || 60;
    const data = metricsAggregator.getTimeseries(metric, from);
    res.json({ metric, from, data });
  });

  // GET /api/v1/events/search
  router.get('/api/v1/events/search', (req, res) => {
    const q = req.query.q as string | undefined;
    if (!q) {
      res.status(400).json({ error: 'Missing search query parameter "q"', code: 'MISSING_QUERY' });
      return;
    }
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
      const events = historyStore.search(q, { limit, offset });
      const total = historyStore.searchCount(q);
      res.json({ query: q, events, total });
    } catch {
      res.json({ query: q, events: [], total: 0 });
    }
  });

  // GET /api/v1/migration/shadow-report
  router.get('/api/v1/migration/shadow-report', (_req, res) => {
    if (!config.shadowModeEnabled) {
      res.status(503).json({
        error: 'Shadow mode is disabled',
        code: 'SHADOW_MODE_DISABLED',
      });
      return;
    }
    if (!config.shadowModeReadOnly) {
      res.status(503).json({
        error: 'Shadow mode must run in read-only comparison mode',
        code: 'SHADOW_MODE_READ_ONLY_REQUIRED',
      });
      return;
    }

    const report = config.shadowReportProvider();
    res.json({
      pass_count: report.passCount,
      fail_count: report.failCount,
      top_diffs: report.topDiffs,
    });
  });

  // GET /api/v2/auth/status
  router.get('/api/v2/auth/status', (_req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isAuthV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('auth_v2', res);
      return;
    }
    res.json({
      domain: 'auth',
      version: 'v2',
      status: 'enabled',
    });
  });

  // GET /api/v2/tasks
  router.get('/api/v2/tasks', (req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isTasksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('tasks_v2', res);
      return;
    }

    const db = config.getMcDb?.();
    if (!db) {
      res.json({ domain: 'tasks', version: 'v2', tasks: [], total: 0, flag_enabled: true, mc_db_connected: false });
      return;
    }

    const status = req.query.status as string | undefined;
    const assignedTo = req.query.assigned_to as string | undefined;
    const priority = req.query.priority as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (assignedTo) { conditions.push('assigned_to = ?'); params.push(assignedTo); }
    if (priority) { conditions.push('priority = ?'); params.push(priority); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const tasks = db
        .prepare(`SELECT id, title, description, status, priority, assigned_to, created_by, created_at, updated_at, due_date, tags, metadata FROM tasks ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM tasks ${where}`)
        .get(...params) as { count: number };

      res.json({ domain: 'tasks', version: 'v2', tasks, total: totalRow.count, flag_enabled: true, mc_db_connected: true });
    } catch (err) {
      res.status(500).json({ error: 'MC DB query failed', code: 'MC_DB_ERROR', detail: (err as Error).message });
    }
  });

  // GET /api/v2/activities
  router.get('/api/v2/activities', (req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isTasksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('tasks_v2', res);
      return;
    }

    const db = config.getMcDb?.();
    if (!db) {
      res.json({ activities: [], total: 0, mc_db_connected: false });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const since = req.query.since as string | undefined;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (since) {
      const sinceTs = Math.floor(new Date(since).getTime() / 1000);
      if (!isNaN(sinceTs)) { conditions.push('created_at > ?'); params.push(sinceTs); }
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const activities = db
        .prepare(`SELECT id, type, entity_type, entity_id, actor, description, data, created_at FROM activities ${where} ORDER BY created_at DESC LIMIT ?`)
        .all(...params, limit);
      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM activities ${where}`)
        .get(...params) as { count: number };

      res.json({ activities, total: totalRow.count, mc_db_connected: true });
    } catch (err) {
      res.status(500).json({ error: 'MC DB query failed', code: 'MC_DB_ERROR', detail: (err as Error).message });
    }
  });

  // GET /api/v2/notifications
  router.get('/api/v2/notifications', (req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isTasksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('tasks_v2', res);
      return;
    }

    const db = config.getMcDb?.();
    if (!db) {
      res.json({ notifications: [], total: 0, mc_db_connected: false });
      return;
    }

    const recipient = req.query.recipient as string | undefined;
    const unreadOnly = req.query.unread_only === 'true';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (recipient) { conditions.push('recipient = ?'); params.push(recipient); }
    if (unreadOnly) { conditions.push('read_at IS NULL'); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const notifications = db
        .prepare(`SELECT id, recipient, type, title, message, source_type, source_id, read_at, created_at FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`)
        .all(...params, limit);
      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM notifications ${where}`)
        .get(...params) as { count: number };

      res.json({ notifications, total: totalRow.count, mc_db_connected: true });
    } catch (err) {
      res.status(500).json({ error: 'MC DB query failed', code: 'MC_DB_ERROR', detail: (err as Error).message });
    }
  });

  // GET /api/v2/webhooks
  router.get('/api/v2/webhooks', (_req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isWebhooksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('webhooks_v2', res);
      return;
    }

    const db = config.getMcDb?.();
    if (!db) {
      res.json({ webhooks: [], total: 0, mc_db_connected: false });
      return;
    }

    try {
      const webhooks = db
        .prepare(`SELECT w.id, w.name, w.url, w.events, w.enabled, w.last_fired_at, w.last_status, w.created_at,
                   (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id) as delivery_count,
                   (SELECT COUNT(*) FROM webhook_deliveries wd WHERE wd.webhook_id = w.id AND wd.status_code >= 200 AND wd.status_code < 300) as success_count
                 FROM webhooks w ORDER BY w.created_at DESC`)
        .all();
      res.json({ webhooks, total: (webhooks as unknown[]).length, mc_db_connected: true });
    } catch (err) {
      res.status(500).json({ error: 'MC DB query failed', code: 'MC_DB_ERROR', detail: (err as Error).message });
    }
  });

  // POST /api/v2/webhooks/test
  router.post('/api/v2/webhooks/test', (_req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isWebhooksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('webhooks_v2', res);
      return;
    }
    res.status(202).json({
      domain: 'webhooks',
      version: 'v2',
      status: 'accepted',
    });
  });

  // GET /api/v1/config
  router.get('/api/v1/config', (_req, res) => {
    const featureFlagNames = Object.keys(config.featureFlags) as FeatureFlagName[];
    const feature_flags = featureFlagNames.map((name) => ({
      name,
      enabled: config.featureFlags[name],
      env_var: FEATURE_FLAG_ENV_VARS[name],
    }));

    res.json({
      config: {
        watch_paths: config.watchPaths,
        metrics_interval_ms: config.metricsIntervalMs,
        timeseries_retention_minutes: config.timeseriesRetentionMinutes,
        shadow_mode_enabled: config.shadowModeEnabled,
        mc_db_connected: config.getMcDb != null && config.getMcDb() != null,
      },
      feature_flags,
    });
  });

  // PUT /api/v1/config
  router.put('/api/v1/config', (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid config body', code: 'INVALID_CONFIG' });
      return;
    }

    if (Array.isArray(body.watch_paths)) {
      config.watchPaths = body.watch_paths as string[];
    }
    if (typeof body.metrics_interval_ms === 'number' && body.metrics_interval_ms > 0) {
      config.metricsIntervalMs = body.metrics_interval_ms;
    }
    if (typeof body.timeseries_retention_minutes === 'number' && body.timeseries_retention_minutes > 0) {
      config.timeseriesRetentionMinutes = body.timeseries_retention_minutes;
    }

    res.json({
      config: {
        watch_paths: config.watchPaths,
        metrics_interval_ms: config.metricsIntervalMs,
        timeseries_retention_minutes: config.timeseriesRetentionMinutes,
      },
    });
  });

  // POST /api/v1/events
  router.post('/api/v1/events', (req, res) => {
    const event = req.body as UAEPEvent;
    if (!event || !event.event_id || !event.type) {
      res.status(400).json({ error: 'Invalid event', code: 'INVALID_EVENT' });
      return;
    }
    eventBus.publish(event);
    res.status(201).json({ status: 'accepted' });
  });

  // POST /api/v1/events/batch
  router.post('/api/v1/events/batch', (req, res) => {
    const events = req.body as UAEPEvent[];
    if (!Array.isArray(events)) {
      res.status(400).json({ error: 'Expected array of events', code: 'INVALID_BATCH' });
      return;
    }
    for (const event of events) {
      eventBus.publish(event);
    }
    res.status(201).json({ status: 'accepted', count: events.length });
  });

  return router;
}
