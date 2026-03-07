import { Router } from 'express';
import type { StateManager } from '../core/state-manager.js';
import type { HistoryStore } from '../core/history-store.js';
import type { MetricsAggregator } from '../core/metrics-aggregator.js';
import type { EventBus } from '../core/event-bus.js';
import type { TaskContextProvider } from '../core/task-context-provider.js';
import type { PaperclipAdapter } from '../core/paperclip-adapter.js';
import type { RuntimeDescriptor, TaskContextRef, UAEPEvent } from '@agent-observatory/shared';

export interface ApiConfig {
  watchPaths: string[];
  metricsIntervalMs: number;
  timeseriesRetentionMinutes: number;
  taskContextProvider?: TaskContextProvider;
  /** R-005: Paperclip 읽기 전용 어댑터 (미설정 시 graceful degradation) */
  paperclipAdapter?: PaperclipAdapter;
}

const DEFAULT_CONFIG: ApiConfig = {
  watchPaths: [],
  metricsIntervalMs: 5000,
  timeseriesRetentionMinutes: 60,
};

function safeParseJsonRecord(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON blobs from legacy rows.
  }
  return undefined;
}

function parseTaskContext(value: string | null): TaskContextRef | undefined {
  const parsed = safeParseJsonRecord(value);
  if (!parsed) return undefined;
  return parsed as TaskContextRef;
}

function parseRuntimeDescriptor(row: {
  runtime_family: string | null;
  runtime_orchestrator: string | null;
  runtime_client: string | null;
}): RuntimeDescriptor | undefined {
  if (!row.runtime_family) return undefined;
  return {
    family: row.runtime_family as RuntimeDescriptor['family'],
    orchestrator: row.runtime_orchestrator as RuntimeDescriptor['orchestrator'] | undefined,
    client: row.runtime_client as RuntimeDescriptor['client'] | undefined,
  };
}

export function createApiRouter(
  stateManager: StateManager,
  historyStore: HistoryStore,
  metricsAggregator: MetricsAggregator,
  eventBus: EventBus,
  config: ApiConfig = DEFAULT_CONFIG,
): Router {
  const router = Router();

  router.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  router.get('/api/v1/agents', (_req, res) => {
    const agents = stateManager.getAllAgents();
    res.json({ agents, total: agents.length });
  });

  router.get('/api/v1/agents/by-team', (_req, res) => {
    const teams = stateManager.getTeams();
    res.json({ teams });
  });

  router.get('/api/v1/agents/health', (_req, res) => {
    void (async () => {
      const agents = stateManager.getAllAgents();

      // Paperclip에서 task/project 이름 batch 조회 (R-005 + R-006 통합)
      const enrichedAgents = await Promise.all(agents.map(async (agent) => {
        let taskName: string | undefined;
        let projectName: string | undefined;
        if (config.paperclipAdapter) {
          const [task, project] = await Promise.all([
            agent.task_id ? config.paperclipAdapter.getTask(agent.task_id) : Promise.resolve(undefined),
            agent.project_id ? config.paperclipAdapter.getProject(agent.project_id) : Promise.resolve(undefined),
          ]);
          taskName = task?.title;
          projectName = project?.name;
        }
        return {
          agent_id: agent.agent_id,
          agent_name: agent.agent_name,
          source: agent.source,
          health_status: agent.health_status,
          status: agent.status,
          context_window_usage: agent.context_window_usage,
          tool_call_success_rate: agent.tool_call_success_rate,
          total_errors: agent.total_errors,
          last_error: agent.last_error,
          last_run_status: agent.last_run_status,
          total_tool_calls: agent.total_tool_calls,
          task_id: agent.task_id,
          task_name: taskName,
          project_id: agent.project_id,
          project_name: projectName,
          last_activity: agent.last_activity,
        };
      }));

      const summary = {
        total: enrichedAgents.length,
        normal: enrichedAgents.filter((a) => a.health_status === 'normal').length,
        caution: enrichedAgents.filter((a) => a.health_status === 'caution').length,
        error: enrichedAgents.filter((a) => a.health_status === 'error').length,
      };

      res.json({ agents: enrichedAgents, summary });
    })();
  });

  router.get('/api/v1/agents/:id', (req, res) => {
    const agent = stateManager.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' });
      return;
    }
    res.json({ agent });
  });

  router.get('/api/v1/agents/:id/events', (req, res) => {
    const agentId = req.params.id;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const type = req.query.type as string | undefined;

    const events = historyStore.getByAgent(agentId, { limit, offset, type });
    const total = historyStore.getAgentEventCount(agentId);

    res.json({ events, total, offset, limit });
  });

  router.get('/api/v1/agents/:id/context', (req, res) => {
    void (async () => {
      const agentId = req.params.id;
      const agent = stateManager.getAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' });
        return;
      }

      const taskContext = config.taskContextProvider?.getAgentContext(agentId);

      // R-005: Paperclip에서 task/project 이름 overlay
      let taskName: string | undefined;
      let projectName: string | undefined;
      if (config.paperclipAdapter) {
        const tid = taskContext?.task_id ?? agent.task_id;
        const pid = taskContext?.project_id ?? agent.project_id;
        const [task, project] = await Promise.all([
          tid ? config.paperclipAdapter.getTask(tid) : Promise.resolve(undefined),
          pid ? config.paperclipAdapter.getProject(pid) : Promise.resolve(undefined),
        ]);
        taskName = task?.title;
        projectName = project?.name;
      }

      res.json({
        task_context: taskContext,
        task_name: taskName,
        project_name: projectName,
      });
    })();
  });

  router.get('/api/v1/sessions', (req, res) => {
    const { date, from, to, source, limit: limitStr, offset: offsetStr } = req.query as Record<string, string | undefined>;
    const limit = limitStr ? Math.min(parseInt(limitStr, 10), 1000) : 200;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    const { rows, total } = historyStore.getSessionSummaries({ date, from, to, source, limit, offset });
    const sessions = rows.map((row) => ({
      session_id: row.session_id,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      source: row.source,
      runtime: parseRuntimeDescriptor(row),
      team_id: row.team_id ?? undefined,
      project_id: row.project_id ?? undefined,
      task_id: row.task_id ?? undefined,
      goal_id: row.goal_id ?? undefined,
      task_context: parseTaskContext(row.task_context),
      model_id: row.model_id ?? undefined,
      start_time: row.start_time,
      end_time: row.end_time ?? undefined,
      total_events: row.total_events,
      total_tokens: row.total_tokens,
      total_cost_usd: row.total_cost_usd,
    }));

    res.json({ sessions, total, limit, offset });
  });

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

  router.get('/api/v1/sessions/:id/context', (req, res) => {
    void (async () => {
      const sessionId = req.params.id;
      const session = historyStore.getSession(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
        return;
      }

      const taskContext = config.taskContextProvider?.getSessionContext(sessionId);

      // R-005: Paperclip에서 task/project 이름 overlay
      let taskName: string | undefined;
      let projectName: string | undefined;
      if (config.paperclipAdapter) {
        const tid = taskContext?.task_id ?? (session.task_id ?? undefined);
        const pid = taskContext?.project_id ?? (session.project_id ?? undefined);
        const [task, project] = await Promise.all([
          tid ? config.paperclipAdapter.getTask(tid) : Promise.resolve(undefined),
          pid ? config.paperclipAdapter.getProject(pid) : Promise.resolve(undefined),
        ]);
        taskName = task?.title;
        projectName = project?.name;
      }

      res.json({
        task_context: taskContext,
        task_name: taskName,
        project_name: projectName,
      });
    })();
  });

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
    const types = typesParam ? typesParam.split(',').map((type) => type.trim()) : undefined;

    const events = historyStore.getSessionReplay(sessionId, { from, to, types, limit, offset });
    const eventTypeCounts = historyStore.getSessionEventTypeCounts(sessionId);
    const toolCallCount = historyStore.getSessionToolCallCount(sessionId);

    const sessionStartMs = new Date(session.start_time).getTime();
    let previousMs = sessionStartMs;

    const replayEvents = events.map((event) => {
      const eventMs = new Date(event.ts).getTime();
      const gap_ms = eventMs - previousMs;
      const offset_ms = eventMs - sessionStartMs;
      previousMs = eventMs;
      return { event, gap_ms, offset_ms };
    });

    const endTime = session.end_time ?? events[events.length - 1]?.ts ?? session.start_time;
    const duration_ms = new Date(endTime).getTime() - sessionStartMs;

    const summary = {
      agent_id: session.agent_id,
      agent_name: session.agent_name,
      source: session.source,
      runtime: parseRuntimeDescriptor(session),
      team_id: session.team_id ?? undefined,
      project_id: session.project_id ?? undefined,
      task_id: session.task_id ?? undefined,
      goal_id: session.goal_id ?? undefined,
      task_context: parseTaskContext(session.task_context),
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

  router.get('/api/v1/metrics/summary', (_req, res) => {
    const metrics = metricsAggregator.getSnapshot();
    res.json({ metrics });
  });

  router.get('/api/v1/dashboard/summary', (req, res) => {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const costSummary = historyStore.getCostSummary({ from, to });
    const topProjects = historyStore.getCostByProject({ from, to });
    const topAgents = historyStore.getCostByAgent({ from, to });
    const topModels = historyStore.getCostByModel({ from, to });
    const budgetAlerts = historyStore.getBudgetAlerts();
    const untrackedSummary = historyStore.getUntrackedSummary({ from, to });

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
      pending_alerts: budgetAlerts.length,
      alert_severity: budgetAlerts.some((alert) => alert.severity === 'critical')
        ? 'critical'
        : budgetAlerts.length > 0
          ? 'warning'
          : 'ok',
      untracked_summary: untrackedSummary,
    });
  });

  router.get('/api/v1/metrics/timeseries', (req, res) => {
    const metric = (req.query.metric as string) ?? 'tokens_per_minute';
    const from = parseInt(req.query.from as string, 10) || 60;
    const data = metricsAggregator.getTimeseries(metric, from);
    res.json({ metric, from, data });
  });

  router.get('/api/v1/events/search', (req, res) => {
    const query = req.query.q as string | undefined;
    if (!query) {
      res.status(400).json({ error: 'Missing search query parameter "q"', code: 'MISSING_QUERY' });
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    try {
      const events = historyStore.search(query, { limit, offset });
      const total = historyStore.searchCount(query);
      res.json({ query, events, total });
    } catch {
      res.json({ query, events: [], total: 0 });
    }
  });

  router.get('/api/v1/config', (_req, res) => {
    res.json({
      config: {
        watch_paths: config.watchPaths,
        metrics_interval_ms: config.metricsIntervalMs,
        timeseries_retention_minutes: config.timeseriesRetentionMinutes,
      },
    });
  });

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

  // ─── AIS Worktree ──────────────────────────────────────────────────────────

  /** AIS 워크트리 에이전트 목록 (agent_id가 ais- 로 시작) */
  router.get('/api/v1/ais/sessions', (_req, res) => {
    const agents = stateManager.getAllAgents().filter((a) => a.agent_id.startsWith('ais-'));
    res.json({ sessions: agents, total: agents.length });
  });

  /** AIS agent.log tail (최근 100줄) */
  router.get('/api/v1/ais/sessions/:agentId/log', async (req, res) => {
    const { agentId } = req.params;

    // 최신 agent.status 이벤트에서 worktree_path 추출 (DESC 정렬 위해 offset trick)
    const events = historyStore.getByAgent(agentId, { type: 'agent.status', limit: 100 });
    const latest = events.at(-1);
    const worktreePath = latest?.data?.['worktree_path'] as string | undefined;

    if (!worktreePath) {
      res.status(404).json({ error: 'No worktree path recorded for this agent', code: 'NO_WORKTREE_PATH' });
      return;
    }

    const logPath = `${worktreePath}/agent.log`;
    try {
      const { readFile, stat } = await import('node:fs/promises');
      const [content, fileStat] = await Promise.all([readFile(logPath, 'utf8'), stat(logPath)]);

      // ANSI strip (簡易)
      const clean = content.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g, '');
      const allLines = clean.split('\n').filter((l) => l.trim().length > 0);
      const MAX_LINES = 100;
      const tail = allLines.slice(-MAX_LINES);

      res.json({
        agent_id: agentId,
        worktree_path: worktreePath,
        lines: tail,
        total_lines: allLines.length,
        truncated: allLines.length > MAX_LINES,
        updated_at: fileStat.mtime.toISOString(),
      });
    } catch {
      res.status(404).json({ error: 'agent.log not found or unreadable', code: 'LOG_NOT_FOUND' });
    }
  });

  router.post('/api/v1/events', (req, res) => {
    const event = req.body as UAEPEvent;
    if (!event || !event.event_id || !event.type) {
      res.status(400).json({ error: 'Invalid event', code: 'INVALID_EVENT' });
      return;
    }

    eventBus.publish(event);
    res.status(201).json({ status: 'accepted' });
  });

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
