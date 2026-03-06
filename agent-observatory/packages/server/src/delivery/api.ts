import { Router } from 'express';
import type { Response } from 'express';
import type Database from 'better-sqlite3';
import type { StateManager } from '../core/state-manager.js';
import { ObservatoryAdapterRegistry } from '../core/adapter-registry.js';
import type { HistoryStore } from '../core/history-store.js';
import type { MetricsAggregator } from '../core/metrics-aggregator.js';
import type { EventBus } from '../core/event-bus.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import type {
  ActivityActorType,
  ActivityEntry,
  ActivityEntityType,
  Approval,
  ApprovalStatus,
  ApprovalType,
  GoalProgress,
  GoalStatus,
  MissionControlTask,
  TaskComment,
} from '@agent-observatory/shared';
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

const COMPLETED_TASK_STATUSES = new Set(['done']);
const APPROVAL_TYPES = new Set<ApprovalType>(['dangerous_action', 'budget_override', 'new_agent']);
const APPROVAL_DECISION_STATUSES = new Set<Exclude<ApprovalStatus, 'pending'>>([
  'approved',
  'rejected',
  'revision_requested',
]);

function getStaleThresholdSeconds(): number {
  const raw = process.env.OBSERVATORY_STALE_THRESHOLD_HOURS;
  const hours = raw ? Number(raw) : 1;
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60 * 60) : 60 * 60;
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  project: string | null;
  goal_id: string | null;
  goal_title: string | null;
  goal_status: string | null;
  assigned_to: string | null;
  checkout_agent_id: string | null;
  checkout_at: number | null;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  updated_at: number;
  due_date: number | null;
  source_path: string | null;
  tags: string | null;
  metadata: string | null;
  comment_count: number;
  blocks_csv: string | null;
  blocked_by_csv: string | null;
  related_csv: string | null;
  open_dependency_count: number;
  is_blocked: number;
  is_stale: number;
};

type ApprovalRow = {
  id: string;
  type: string;
  requested_by: string;
  status: string;
  payload: string | null;
  decision_note: string | null;
  decided_by: string | null;
  decided_at: number | null;
  created_at: number;
};

type ActivityRow = {
  id: string;
  type: string;
  actor_type: string | null;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  description: string | null;
  data: string | null;
  created_at: number;
};

function getStaleCutoff(nowSeconds = Math.floor(Date.now() / 1000)): number {
  return nowSeconds - getStaleThresholdSeconds();
}

function splitCsv(value: string | null): string[] {
  return value ? value.split('||').filter(Boolean) : [];
}

function safeParseJsonRecord(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON blobs from older rows.
  }
  return undefined;
}

function mapApprovalRow(row: ApprovalRow): Approval {
  return {
    id: row.id,
    type: row.type as ApprovalType,
    requested_by: row.requested_by,
    status: row.status as ApprovalStatus,
    payload: safeParseJsonRecord(row.payload),
    decision_note: row.decision_note ?? undefined,
    decided_by: row.decided_by ?? undefined,
    decided_at: row.decided_at ?? undefined,
    created_at: row.created_at,
  };
}

function mapActivityRow(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    type: row.type,
    actor_type: (row.actor_type ?? 'system') as ActivityActorType,
    entity_type: row.entity_type as ActivityEntityType,
    entity_id: row.entity_id ?? undefined,
    actor: row.actor ?? undefined,
    description: row.description ?? undefined,
    data: safeParseJsonRecord(row.data),
    created_at: row.created_at,
  };
}

function mapTaskRow(task: TaskRow, staleCutoff = getStaleCutoff()): MissionControlTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? undefined,
    status: task.status,
    priority: task.priority,
    project: task.project ?? undefined,
    goal_id: task.goal_id ?? undefined,
    goal: task.goal_id && task.goal_title
      ? {
          id: task.goal_id,
          title: task.goal_title,
          status: (task.goal_status ?? 'active') as GoalStatus,
        }
      : undefined,
    assigned_to: task.assigned_to ?? undefined,
    checkout_agent_id: task.checkout_agent_id ?? undefined,
    checkout_at: task.checkout_at ?? undefined,
    created_by: task.created_by ?? undefined,
    created_at: task.created_at,
    started_at: task.started_at ?? undefined,
    updated_at: task.updated_at,
    due_date: task.due_date ?? undefined,
    source_path: task.source_path ?? undefined,
    tags: task.tags ?? undefined,
    metadata: task.metadata ?? undefined,
    is_stale: task.is_stale !== undefined
      ? Boolean(task.is_stale)
      : task.status === 'in_progress' && (task.started_at ?? task.updated_at) <= staleCutoff,
    is_blocked: Boolean(task.is_blocked),
    open_dependency_count: task.open_dependency_count ?? 0,
    relation_summary: {
      blocks: splitCsv(task.blocks_csv),
      blocked_by: splitCsv(task.blocked_by_csv),
      related: splitCsv(task.related_csv),
    },
    comment_count: task.comment_count ?? 0,
  };
}

function getTaskSelectSql(where = ''): string {
  return `
    SELECT
      tasks.id,
      tasks.title,
      tasks.description,
      tasks.status,
      tasks.priority,
      tasks.project,
      tasks.goal_id,
      goals.title AS goal_title,
      goals.status AS goal_status,
      assigned_to,
      checkout_agent_id,
      checkout_at,
      created_by,
      tasks.created_at,
      started_at,
      tasks.updated_at,
      due_date,
      tasks.source_path,
      tags,
      metadata,
      COALESCE((SELECT COUNT(*) FROM task_comments comments WHERE comments.task_id = tasks.id), 0) AS comment_count,
      (SELECT GROUP_CONCAT(related_task_id, '||') FROM task_relations rel WHERE rel.task_id = tasks.id AND rel.type = 'blocks') AS blocks_csv,
      (SELECT GROUP_CONCAT(related_task_id, '||') FROM task_relations rel WHERE rel.task_id = tasks.id AND rel.type = 'blocked_by') AS blocked_by_csv,
      (SELECT GROUP_CONCAT(related_task_id, '||') FROM task_relations rel WHERE rel.task_id = tasks.id AND rel.type = 'related') AS related_csv,
      COALESCE((
        SELECT COUNT(*)
        FROM task_relations rel
        JOIN tasks blocker ON blocker.id = rel.related_task_id
        WHERE rel.task_id = tasks.id
          AND rel.type = 'blocked_by'
          AND blocker.status NOT IN ('done')
      ), 0) AS open_dependency_count,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM task_relations rel
          JOIN tasks blocker ON blocker.id = rel.related_task_id
          WHERE rel.task_id = tasks.id
            AND rel.type = 'blocked_by'
            AND blocker.status NOT IN ('done')
        ) THEN 1
        ELSE 0
      END AS is_blocked,
      CASE
        WHEN tasks.status = 'in_progress' AND COALESCE(started_at, tasks.updated_at) <= ? THEN 1
        ELSE 0
      END AS is_stale
    FROM tasks
    LEFT JOIN goals ON goals.id = tasks.goal_id
    ${where}
  `;
}

function getTaskById(db: Database.Database, taskId: string): MissionControlTask | null {
  const row = db.prepare(`${getTaskSelectSql('WHERE id = ?')} LIMIT 1`).get(
    getStaleCutoff(),
    taskId,
  ) as TaskRow | undefined;
  return row ? mapTaskRow(row) : null;
}

function getApprovalById(db: Database.Database, approvalId: string): Approval | null {
  const row = db.prepare(`
    SELECT id, type, requested_by, status, payload, decision_note, decided_by, decided_at, created_at
    FROM approvals
    WHERE id = ?
  `).get(approvalId) as ApprovalRow | undefined;
  return row ? mapApprovalRow(row) : null;
}

function getPendingApprovalCount(db: Database.Database): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM approvals
    WHERE status = 'pending'
  `).get() as { count: number };
  return row.count;
}

function getGoalProgress(db: Database.Database): GoalProgress[] {
  const goals = db.prepare(`
    SELECT id, title, description, level, parent_id, status, source_path
    FROM goals
    ORDER BY level ASC, title ASC
  `).all() as Array<{
    id: string;
    title: string;
    description: string | null;
    level: number;
    parent_id: string | null;
    status: string;
    source_path: string | null;
  }>;

  const taskRows = db.prepare(`
    SELECT goal_id, status, project
    FROM tasks
    WHERE goal_id IS NOT NULL
  `).all() as Array<{
    goal_id: string;
    status: string;
    project: string | null;
  }>;

  const byGoal = new Map<string, GoalProgress>();
  const children = new Map<string, string[]>();

  for (const goal of goals) {
    byGoal.set(goal.id, {
      id: goal.id,
      title: goal.title,
      description: goal.description ?? undefined,
      level: goal.level,
      parent_id: goal.parent_id ?? undefined,
      status: goal.status as GoalProgress['status'],
      source_path: goal.source_path ?? undefined,
      total_tasks: 0,
      completed_tasks: 0,
      active_tasks: 0,
      completion_ratio: 0,
      projects: [],
      children: [],
    });
    if (goal.parent_id) {
      const bucket = children.get(goal.parent_id);
      if (bucket) {
        bucket.push(goal.id);
      } else {
        children.set(goal.parent_id, [goal.id]);
      }
    }
  }

  for (const task of taskRows) {
    const goal = byGoal.get(task.goal_id);
    if (!goal) continue;
    goal.total_tasks += 1;
    goal.completed_tasks += COMPLETED_TASK_STATUSES.has(task.status) ? 1 : 0;
    goal.active_tasks += COMPLETED_TASK_STATUSES.has(task.status) ? 0 : 1;
    if (task.project && !goal.projects.includes(task.project)) {
      goal.projects.push(task.project);
    }
  }

  const aggregate = (goalId: string): GoalProgress => {
    const goal = byGoal.get(goalId)!;
    for (const childId of children.get(goalId) ?? []) {
      const child = aggregate(childId);
      goal.children.push(child);
      goal.total_tasks += child.total_tasks;
      goal.completed_tasks += child.completed_tasks;
      goal.active_tasks += child.active_tasks;
      for (const project of child.projects) {
        if (!goal.projects.includes(project)) {
          goal.projects.push(project);
        }
      }
    }
    goal.completion_ratio = goal.total_tasks > 0 ? goal.completed_tasks / goal.total_tasks : 0;
    goal.projects.sort((left, right) => left.localeCompare(right));
    return goal;
  };

  return goals
    .filter((goal) => !goal.parent_id || !byGoal.has(goal.parent_id))
    .map((goal) => aggregate(goal.id))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function getStaleTasks(db: Database.Database, limit = 10): Array<{
  id: string;
  title: string;
  project?: string;
  assigned_to?: string;
  checkout_agent_id?: string;
  started_at?: number;
  updated_at: number;
  stale_for_seconds: number;
}> {
  const staleCutoff = getStaleCutoff();
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(`
    SELECT id, title, project, assigned_to, checkout_agent_id, started_at, updated_at
    FROM tasks
    WHERE status = 'in_progress'
      AND COALESCE(started_at, updated_at) <= ?
    ORDER BY COALESCE(started_at, updated_at) ASC
    LIMIT ?
  `).all(staleCutoff, limit) as Array<{
    id: string;
    title: string;
    project: string | null;
    assigned_to: string | null;
    checkout_agent_id: string | null;
    started_at: number | null;
    updated_at: number;
  }>;

  return rows.map((row) => {
    const startedAt = row.started_at ?? row.updated_at;
    return {
      id: row.id,
      title: row.title,
      project: row.project ?? undefined,
      assigned_to: row.assigned_to ?? undefined,
      checkout_agent_id: row.checkout_agent_id ?? undefined,
      started_at: row.started_at ?? undefined,
      updated_at: row.updated_at,
      stale_for_seconds: Math.max(now - startedAt, 0),
    };
  });
}

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

function insertActivityRecord(db: Database.Database, activity: ActivityEntry): ActivityEntry {
  db.prepare(`
    INSERT INTO activities (id, type, actor_type, entity_type, entity_id, actor, description, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    activity.id,
    activity.type,
    activity.actor_type,
    activity.entity_type,
    activity.entity_id ?? null,
    activity.actor ?? null,
    activity.description ?? null,
    activity.data ? JSON.stringify(activity.data) : null,
    activity.created_at,
  );

  return activity;
}

function publishActivityEvent(
  eventBus: EventBus,
  activity: ActivityEntry,
  options: {
    agentId?: string;
    sessionId?: string;
    extra?: Record<string, unknown>;
  } = {},
): void {
  eventBus.publish({
    ts: new Date(activity.created_at * 1000).toISOString(),
    event_id: `evt-activity-${activity.id}`,
    source: 'mission_control',
    agent_id: options.agentId ?? activity.actor ?? 'observatory',
    session_id: options.sessionId ?? 'mission_control_api',
    type: 'activity.new',
    data: {
      ...activity,
      ...options.extra,
    },
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
  const adapterRegistry = new ObservatoryAdapterRegistry(config.watchPaths);

  const recordActivity = (
    db: Database.Database,
    activity: Omit<ActivityEntry, 'id'> & { id?: string },
    options: {
      agentId?: string;
      extra?: Record<string, unknown>;
    } = {},
  ): ActivityEntry => {
    const entry = insertActivityRecord(db, {
      ...activity,
      id: activity.id ?? `${activity.type}_${activity.entity_id ?? 'global'}_${activity.created_at}`,
    });
    publishActivityEvent(eventBus, entry, {
      agentId: options.agentId,
      extra: options.extra,
    });
    return entry;
  };

  // GET /api/v1/health
  router.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

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
      project_id: r.project_id ?? undefined,
      model_id: r.model_id ?? undefined,
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
      project_id: session.project_id ?? undefined,
      model_id: session.model_id ?? undefined,
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

  // GET /api/v1/dashboard/summary
  router.get('/api/v1/dashboard/summary', (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const costSummary = historyStore.getCostSummary({ from, to });
    const topProjects = historyStore.getCostByProject({ from, to });
    const topAgents = historyStore.getCostByAgent({ from, to });
    const topModels = historyStore.getCostByModel({ from, to });
    const budgetAlerts = historyStore.getBudgetAlerts();
    const mcDb = config.getMcDb?.();
    const staleTasks = mcDb ? getStaleTasks(mcDb, 10) : [];
    const goalProgress = mcDb ? getGoalProgress(mcDb) : [];
    const pendingApprovals = mcDb ? getPendingApprovalCount(mcDb) : 0;
    const alertSeverity = budgetAlerts.some((alert) => alert.severity === 'critical')
      ? 'critical'
      : budgetAlerts.length > 0 || staleTasks.length > 0
        ? 'warning'
        : 'ok';

    const withPercentages = <T extends { total_cost_usd: number }>(rows: T[]) =>
      rows.map((row) => ({
        ...row,
        cost_percentage: costSummary.total_cost_usd > 0
          ? (row.total_cost_usd / costSummary.total_cost_usd) * 100
          : 0,
      }));

    res.json({
      time_range: {
        from: from ?? '1970-01-01T00:00:00Z',
        to: to ?? new Date().toISOString(),
      },
      cost_summary: costSummary,
      top_projects: withPercentages(topProjects).slice(0, 5),
      top_agents: withPercentages(topAgents).slice(0, 5),
      top_models: withPercentages(topModels).slice(0, 5),
      budget_alerts: budgetAlerts,
      stale_tasks: staleTasks,
      goal_progress: goalProgress,
      pending_alerts: budgetAlerts.length + staleTasks.length,
      pending_approvals: pendingApprovals,
      alert_severity: alertSeverity,
      mc_db_connected: mcDb != null,
    });
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
    const project = req.query.project as string | undefined;
    const goalId = req.query.goal_id as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const staleCutoff = getStaleCutoff();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (assignedTo) { conditions.push('assigned_to = ?'); params.push(assignedTo); }
    if (priority) { conditions.push('priority = ?'); params.push(priority); }
    if (project) { conditions.push('project = ?'); params.push(project); }
    if (goalId) { conditions.push('goal_id = ?'); params.push(goalId); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const tasks = db
        .prepare(`${getTaskSelectSql(where)} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .all(staleCutoff, ...params, limit, offset)
        .map((task) => mapTaskRow(task as TaskRow, staleCutoff));
      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM tasks ${where}`)
        .get(...params) as { count: number };

      res.json({ domain: 'tasks', version: 'v2', tasks, total: totalRow.count, flag_enabled: true, mc_db_connected: true });
    } catch (err) {
      res.status(500).json({ error: 'MC DB query failed', code: 'MC_DB_ERROR', detail: (err as Error).message });
    }
  });

  // GET /api/v2/tasks/:id
  router.get('/api/v2/tasks/:id', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const task = getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found', code: 'TASK_NOT_FOUND' });
      return;
    }

    res.json({ domain: 'tasks', version: 'v2', task });
  });

  // POST /api/v2/tasks/:id/checkout
  router.post('/api/v2/tasks/:id/checkout', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const taskId = req.params.id;
    const agentId = typeof req.body?.agent_id === 'string' ? req.body.agent_id.trim() : '';
    if (!agentId) {
      res.status(400).json({ error: 'agent_id is required', code: 'MISSING_AGENT_ID' });
      return;
    }

    const checkoutAt = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      UPDATE tasks
      SET checkout_agent_id = ?, checkout_at = ?
      WHERE id = ?
        AND (checkout_agent_id IS NULL OR checkout_agent_id = ?)
    `).run(agentId, checkoutAt, taskId, agentId);

    if (result.changes === 0) {
      const task = getTaskById(db, taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found', code: 'TASK_NOT_FOUND' });
        return;
      }
      res.status(409).json({
        error: 'Task is already checked out by another agent',
        code: 'TASK_CHECKOUT_CONFLICT',
        task,
      });
      return;
    }

    recordActivity(db, {
      id: `task_checkout_${taskId}_${checkoutAt}`,
      type: 'task_checkout',
      actor_type: 'agent',
      entity_type: 'task',
      entity_id: taskId,
      actor: agentId,
      description: `Task "${taskId}" was checked out by ${agentId}`,
      data: { checkout_agent_id: agentId, checkout_at: checkoutAt },
      created_at: checkoutAt,
    }, {
      agentId,
    });

    const task = getTaskById(db, taskId);
    if (task) {
      eventBus.publish({
        ts: new Date().toISOString(),
        event_id: `evt-task-sync-${taskId}-${checkoutAt}`,
        source: 'mission_control',
        agent_id: agentId,
        session_id: 'mission_control_api',
        type: 'task.sync',
        data: task as unknown as Record<string, unknown>,
      });
    }
    res.json({
      domain: 'tasks',
      version: 'v2',
      status: 'checked_out',
      task,
    });
  });

  // DELETE /api/v2/tasks/:id/checkout
  router.delete('/api/v2/tasks/:id/checkout', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const taskId = req.params.id;
    const currentTask = getTaskById(db, taskId);
    if (!currentTask) {
      res.status(404).json({ error: 'Task not found', code: 'TASK_NOT_FOUND' });
      return;
    }

    const releasedAt = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE tasks
      SET checkout_agent_id = NULL, checkout_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(releasedAt, taskId);

    const task = getTaskById(db, taskId);
    if (task) {
      eventBus.publish({
        ts: new Date().toISOString(),
        event_id: `evt-task-sync-release-${taskId}-${releasedAt}`,
        source: 'mission_control',
        agent_id: currentTask.checkout_agent_id ?? 'observatory',
        session_id: 'mission_control_api',
        type: 'task.sync',
        data: task as unknown as Record<string, unknown>,
      });
    }
    recordActivity(db, {
      id: `task_release_${taskId}_${releasedAt}`,
      type: 'task_release',
      actor_type: currentTask.checkout_agent_id ? 'agent' : 'system',
      entity_type: 'task',
      entity_id: taskId,
      actor: currentTask.checkout_agent_id ?? 'observatory',
      description: `Task "${taskId}" checkout was released`,
      data: { released_at: releasedAt },
      created_at: releasedAt,
    }, {
      agentId: currentTask.checkout_agent_id ?? 'observatory',
    });

    res.json({
      domain: 'tasks',
      version: 'v2',
      status: 'released',
      task,
    });
  });

  // GET /api/v2/tasks/:id/comments
  router.get('/api/v2/tasks/:id/comments', (req, res) => {
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
      res.json({ domain: 'tasks', version: 'v2', comments: [], total: 0, mc_db_connected: false });
      return;
    }

    const task = getTaskById(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found', code: 'TASK_NOT_FOUND' });
      return;
    }

    const comments = db.prepare(`
      SELECT id, task_id, author_agent_id, body, created_at
      FROM task_comments
      WHERE task_id = ?
      ORDER BY created_at ASC
    `).all(req.params.id) as TaskComment[];

    res.json({ domain: 'tasks', version: 'v2', comments, total: comments.length, mc_db_connected: true });
  });

  // POST /api/v2/tasks/:id/comments
  router.post('/api/v2/tasks/:id/comments', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const taskId = req.params.id;
    const task = getTaskById(db, taskId);
    if (!task) {
      res.status(404).json({ error: 'Task not found', code: 'TASK_NOT_FOUND' });
      return;
    }

    const authorAgentId = typeof req.body?.author_agent_id === 'string' ? req.body.author_agent_id.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!authorAgentId || !body) {
      res.status(400).json({ error: 'author_agent_id and body are required', code: 'INVALID_COMMENT' });
      return;
    }

    const createdAt = Math.floor(Date.now() / 1000);
    const comment = {
      id: `comment_${taskId}_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      author_agent_id: authorAgentId,
      body,
      created_at: createdAt,
    };

    db.prepare(`
      INSERT INTO task_comments (id, task_id, author_agent_id, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(comment.id, comment.task_id, comment.author_agent_id, comment.body, comment.created_at);

    recordActivity(db, {
      id: `task_comment_${comment.id}`,
      type: 'task_comment',
      actor_type: 'agent',
      entity_type: 'task',
      entity_id: taskId,
      actor: authorAgentId,
      description: `Comment added to task "${taskId}"`,
      data: { comment_id: comment.id },
      created_at: createdAt,
    }, {
      agentId: authorAgentId,
    });
    eventBus.publish({
      ts: new Date().toISOString(),
      event_id: `evt-task-sync-comment-${comment.id}`,
      source: 'mission_control',
      agent_id: authorAgentId,
      session_id: 'mission_control_api',
      type: 'task.sync',
      data: (getTaskById(db, taskId) ?? task) as unknown as Record<string, unknown>,
    });

    res.status(201).json({ domain: 'tasks', version: 'v2', comments: [comment], total: 1, mc_db_connected: true });
  });

  // GET /api/v2/goals
  router.get('/api/v2/goals', (_req, res) => {
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
      res.json({ domain: 'goals', version: 'v2', goals: [], total: 0, mc_db_connected: false });
      return;
    }

    const goals = getGoalProgress(db);
    res.json({ domain: 'goals', version: 'v2', goals, total: goals.length, mc_db_connected: true });
  });

  // GET /api/v2/approvals
  router.get('/api/v2/approvals', (req, res) => {
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
      res.json({ domain: 'approvals', version: 'v2', approvals: [], total: 0, pending: 0, mc_db_connected: false });
      return;
    }

    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }
    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const approvals = db.prepare(`
      SELECT id, type, requested_by, status, payload, decision_note, decided_by, decided_at, created_at
      FROM approvals
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as ApprovalRow[];
    const totalRow = db.prepare(`
      SELECT COUNT(*) AS count
      FROM approvals
      ${where}
    `).get(...params) as { count: number };

    res.json({
      domain: 'approvals',
      version: 'v2',
      approvals: approvals.map(mapApprovalRow),
      total: totalRow.count,
      pending: getPendingApprovalCount(db),
      mc_db_connected: true,
    });
  });

  // GET /api/v2/approvals/:id
  router.get('/api/v2/approvals/:id', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const approval = getApprovalById(db, req.params.id);
    if (!approval) {
      res.status(404).json({ error: 'Approval not found', code: 'APPROVAL_NOT_FOUND' });
      return;
    }

    res.json({ domain: 'approvals', version: 'v2', approval, mc_db_connected: true });
  });

  // POST /api/v2/approvals
  router.post('/api/v2/approvals', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
    const requestedBy = typeof req.body?.requested_by === 'string' ? req.body.requested_by.trim() : '';
    const payload = req.body?.payload && typeof req.body.payload === 'object'
      ? req.body.payload as Record<string, unknown>
      : undefined;

    if (!APPROVAL_TYPES.has(type as ApprovalType) || !requestedBy) {
      res.status(400).json({ error: 'type and requested_by are required', code: 'INVALID_APPROVAL_REQUEST' });
      return;
    }

    const createdAt = Math.floor(Date.now() / 1000);
    const id = `approval_${createdAt}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO approvals (id, type, requested_by, status, payload, created_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(id, type, requestedBy, payload ? JSON.stringify(payload) : null, createdAt);

    const approval = getApprovalById(db, id);
    if (!approval) {
      res.status(500).json({ error: 'Failed to create approval', code: 'APPROVAL_CREATE_FAILED' });
      return;
    }

    recordActivity(db, {
      id: `approval_created_${id}`,
      type: 'approval_created',
      actor_type: 'agent',
      entity_type: 'approval',
      entity_id: id,
      actor: requestedBy,
      description: `Approval request ${id} was created`,
      data: { approval_type: type },
      created_at: createdAt,
    }, {
      agentId: requestedBy,
      extra: {
        approval,
      },
    });

    res.status(201).json({ domain: 'approvals', version: 'v2', approval, mc_db_connected: true });
  });

  // PATCH /api/v2/approvals/:id
  router.patch('/api/v2/approvals/:id', (req, res) => {
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
      res.status(503).json({ error: 'Mission Control DB not connected', code: 'MC_DB_NOT_CONNECTED' });
      return;
    }

    const currentApproval = getApprovalById(db, req.params.id);
    if (!currentApproval) {
      res.status(404).json({ error: 'Approval not found', code: 'APPROVAL_NOT_FOUND' });
      return;
    }

    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    const decisionNote = typeof req.body?.decision_note === 'string' ? req.body.decision_note.trim() : '';
    const decidedBy = typeof req.body?.decided_by === 'string' && req.body.decided_by.trim()
      ? req.body.decided_by.trim()
      : 'user';

    if (!APPROVAL_DECISION_STATUSES.has(status as Exclude<ApprovalStatus, 'pending'>)) {
      res.status(400).json({ error: 'A terminal approval status is required', code: 'INVALID_APPROVAL_STATUS' });
      return;
    }

    const decidedAt = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE approvals
      SET status = ?, decision_note = ?, decided_by = ?, decided_at = ?
      WHERE id = ?
    `).run(status, decisionNote || null, decidedBy, decidedAt, req.params.id);

    const approval = getApprovalById(db, req.params.id);
    if (!approval) {
      res.status(500).json({ error: 'Failed to update approval', code: 'APPROVAL_UPDATE_FAILED' });
      return;
    }

    recordActivity(db, {
      id: `approval_${status}_${req.params.id}_${decidedAt}`,
      type: `approval_${status}`,
      actor_type: decidedBy === 'user' ? 'user' : 'agent',
      entity_type: 'approval',
      entity_id: req.params.id,
      actor: decidedBy,
      description: `Approval ${req.params.id} was marked ${status}`,
      data: {
        previous_status: currentApproval.status,
        decision_note: decisionNote || undefined,
      },
      created_at: decidedAt,
    }, {
      agentId: decidedBy,
      extra: {
        approval,
      },
    });

    res.json({ domain: 'approvals', version: 'v2', approval, mc_db_connected: true });
  });

  // GET /api/v2/adapters
  router.get('/api/v2/adapters', (_req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isTasksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('tasks_v2', res);
      return;
    }

    const adapters = adapterRegistry.list();
    res.json({
      domain: 'adapters',
      version: 'v2',
      adapters,
      total: adapters.length,
    });
  });

  // POST /api/v2/adapters/:type/test
  router.post('/api/v2/adapters/:type/test', async (req, res) => {
    if (isKillSwitchAllV2Enabled(config.featureFlags)) {
      sendV2KillSwitchEnabled(res);
      return;
    }
    if (!isTasksV2Enabled(config.featureFlags)) {
      sendFeatureFlagDisabled('tasks_v2', res);
      return;
    }

    const result = await adapterRegistry.test(req.params.type);
    if (!result) {
      res.status(404).json({ error: 'Adapter not found', code: 'ADAPTER_NOT_FOUND' });
      return;
    }

    res.json({
      domain: 'adapters',
      version: 'v2',
      adapter: result.adapter,
      result: result.result,
    });
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
      res.json({ domain: 'activities', version: 'v2', activities: [], total: 0, offset: 0, limit: 50, mc_db_connected: false });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const since = (req.query.since as string | undefined)
      ?? (req.query.from as string | undefined)
      ?? (req.query.date_from as string | undefined);
    const until = (req.query.to as string | undefined)
      ?? (req.query.date_to as string | undefined);
    const actorType = req.query.actor_type as string | undefined;
    const entityType = req.query.entity_type as string | undefined;
    const entityId = req.query.entity_id as string | undefined;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (since) {
      const sinceTs = Math.floor(new Date(since).getTime() / 1000);
      if (!isNaN(sinceTs)) { conditions.push('created_at > ?'); params.push(sinceTs); }
    }
    if (until) {
      const untilTs = Math.floor(new Date(until).getTime() / 1000);
      if (!isNaN(untilTs)) { conditions.push('created_at <= ?'); params.push(untilTs); }
    }
    if (actorType) {
      conditions.push('actor_type = ?');
      params.push(actorType);
    }
    if (entityType) {
      conditions.push('entity_type = ?');
      params.push(entityType);
    }
    if (entityId) {
      conditions.push('entity_id = ?');
      params.push(entityId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const activities = db
        .prepare(`
          SELECT id, type, actor_type, entity_type, entity_id, actor, description, data, created_at
          FROM activities
          ${where}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `)
        .all(...params, limit, offset)
        .map((activity) => mapActivityRow(activity as ActivityRow));
      const totalRow = db
        .prepare(`SELECT COUNT(*) as count FROM activities ${where}`)
        .get(...params) as { count: number };

      res.json({ domain: 'activities', version: 'v2', activities, total: totalRow.count, offset, limit, mc_db_connected: true });
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
        stale_threshold_hours: getStaleThresholdSeconds() / 3600,
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
        stale_threshold_hours: getStaleThresholdSeconds() / 3600,
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
