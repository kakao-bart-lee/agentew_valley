import Database from 'better-sqlite3';
import type {
  Goal,
  GoalProgress,
  TaskComment,
  UAEPEvent,
} from '@agent-observatory/shared';

function makeRelationId(type: string, taskId: string, relatedTaskId: string): string {
  return `${type}:${taskId}:${relatedTaskId}`;
}

function isCompletedTaskStatus(status: string): boolean {
  return status === 'done';
}

export class HistoryStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? process.env.OBSERVATORY_DB_PATH ?? ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT UNIQUE NOT NULL,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        span_id TEXT,
        parent_span_id TEXT,
        team_id TEXT,
        data TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id, ts);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_team ON events(team_id);

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        source TEXT NOT NULL,
        team_id TEXT,
        project_id TEXT,
        model_id TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        total_events INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'inbox', -- inbox | assigned | in_progress | review | quality_review | done
        priority TEXT DEFAULT 'medium', -- low | medium | high | urgent
        project TEXT,
        goal_id TEXT,
        assigned_to TEXT, -- agent_id
        checkout_agent_id TEXT,
        checkout_at INTEGER,
        created_by TEXT,
        created_at INTEGER NOT NULL, -- Unix timestamp
        started_at INTEGER,
        updated_at INTEGER NOT NULL, -- Unix timestamp
        due_date INTEGER,
        source_path TEXT,
        tags TEXT, -- JSON array
        metadata TEXT -- JSON object
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        level INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        source_path TEXT,
        FOREIGN KEY (parent_id) REFERENCES goals(id)
      );
      CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_id);
      CREATE INDEX IF NOT EXISTS idx_goals_source_path ON goals(source_path);

      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author_agent_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at);

      CREATE TABLE IF NOT EXISTS task_relations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        task_id TEXT NOT NULL,
        related_task_id TEXT NOT NULL,
        source_path TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (related_task_id) REFERENCES tasks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_relations_task ON task_relations(task_id, type);
      CREATE INDEX IF NOT EXISTS idx_task_relations_related ON task_relations(related_task_id, type);
      CREATE INDEX IF NOT EXISTS idx_task_relations_source_path ON task_relations(source_path);

      CREATE TABLE IF NOT EXISTS agent_runtime_state (
        agent_id TEXT PRIMARY KEY,
        total_tokens INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0,
        last_error TEXT,
        last_run_status TEXT DEFAULT 'idle',
        context_window_usage REAL,
        recent_tool_call_count INTEGER DEFAULT 0,
        tool_call_success_rate REAL DEFAULT 1,
        health_status TEXT DEFAULT 'normal',
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_runtime_health ON agent_runtime_state(health_status);

      CREATE TABLE IF NOT EXISTS agent_profiles (
        agent_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        budget_monthly_cents INTEGER,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_budget ON agent_profiles(budget_monthly_cents);

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- task_created | task_updated | comment_added | agent_status_change ...
        actor_type TEXT NOT NULL DEFAULT 'system', -- agent | user | system
        entity_type TEXT NOT NULL, -- task | agent | comment
        entity_id TEXT,
        actor TEXT, -- Who performed the action
        description TEXT, -- Human readable description
        data TEXT, -- JSON context
        created_at INTEGER NOT NULL -- Unix timestamp
      );
      CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_activities_actor_type ON activities(actor_type, created_at);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT,
        decision_note TEXT,
        decided_by TEXT,
        decided_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_type ON approvals(type, created_at);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL, -- agent_id
        type TEXT NOT NULL, -- assignment | mention | status_change | due_date
        title TEXT NOT NULL,
        message TEXT,
        source_type TEXT,
        source_id TEXT,
        read_at INTEGER, -- NULL if unread
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient, read_at);

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        events TEXT, -- JSON array
        enabled INTEGER DEFAULT 1,
        last_fired_at INTEGER,
        last_status INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        status_code INTEGER,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
    `);

    this.ensureSchemaCompatibility();
    this.initFTS();
  }

  private ensureSchemaCompatibility(): void {
    for (const [table, columns] of Object.entries({
      sessions: ['project_id TEXT', 'model_id TEXT'],
      tasks: [
        'project TEXT',
        'goal_id TEXT',
        'checkout_agent_id TEXT',
        'checkout_at INTEGER',
        'started_at INTEGER',
        'source_path TEXT',
      ],
      activities: [
        "actor_type TEXT NOT NULL DEFAULT 'system'",
        'entity_type TEXT',
        'entity_id TEXT',
      ],
    })) {
      for (const column of columns) {
        this.ensureColumn(table, column);
      }
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
      CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_checkout ON tasks(checkout_agent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_source_path ON tasks(source_path);
      CREATE INDEX IF NOT EXISTS idx_activities_actor_type ON activities(actor_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_type ON approvals(type, created_at);
    `);
  }

  private ensureColumn(table: string, columnDef: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    } catch {
      // Column already exists.
    }
  }

  private initFTS(): void {
    // FTS5 for full-text search on events
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
        event_id, type, agent_id, data,
        content=events, content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
        INSERT INTO events_fts(rowid, event_id, type, agent_id, data)
        VALUES (new.id, new.event_id, new.type, new.agent_id, new.data);
      END;

      CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, event_id, type, agent_id, data)
        VALUES ('delete', old.id, old.event_id, old.type, old.agent_id, old.data);
      END;

      CREATE TRIGGER IF NOT EXISTS events_au AFTER UPDATE ON events BEGIN
        INSERT INTO events_fts(events_fts, rowid, event_id, type, agent_id, data)
        VALUES ('delete', old.id, old.event_id, old.type, old.agent_id, old.data);
        INSERT INTO events_fts(rowid, event_id, type, agent_id, data)
        VALUES (new.id, new.event_id, new.type, new.agent_id, new.data);
      END;
    `);
  }

  /** Get the underlying database instance (for sharing with MetricsAggregator) */
  getDb(): Database.Database {
    return this.db;
  }

  append(event: UAEPEvent): void {
    const dataStr = event.data ? JSON.stringify(event.data) : null;

    this.db.prepare(`
      INSERT OR IGNORE INTO events (event_id, ts, type, source, agent_id, session_id, span_id, parent_span_id, team_id, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.event_id,
      event.ts,
      event.type,
      event.source,
      event.agent_id,
      event.session_id,
      event.span_id ?? null,
      event.parent_span_id ?? null,
      event.team_id ?? null,
      dataStr,
    );

    // Update sessions table
    this.updateSession(event);
  }

  private updateSession(event: UAEPEvent): void {
    if (event.type === 'session.start') {
      const budgetMonthlyCents = typeof event.data?.['budget_monthly_cents'] === 'number'
        ? Math.round(event.data['budget_monthly_cents'] as number)
        : undefined;

      this.db.prepare(`
        INSERT OR IGNORE INTO sessions (
          session_id, agent_id, agent_name, source, team_id, project_id, model_id,
          start_time, total_events, total_tokens, total_cost_usd
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
      `).run(
        event.session_id,
        event.agent_id,
        event.agent_name ?? event.agent_id,
        event.source,
        event.team_id ?? null,
        event.project_id ?? null,
        event.model_id ?? (event.data?.['model_id'] as string | undefined) ?? null,
        event.ts,
      );

      this.upsertAgentProfile({
        agent_id: event.agent_id,
        agent_name: event.agent_name ?? event.agent_id,
        budget_monthly_cents: budgetMonthlyCents,
      });
    }

    if (event.type === 'session.end') {
      this.db.prepare(`
        UPDATE sessions SET end_time = ? WHERE session_id = ?
      `).run(event.ts, event.session_id);
    }

    // Increment event count
    this.db.prepare(`
      UPDATE sessions SET total_events = total_events + 1 WHERE session_id = ?
    `).run(event.session_id);

    // Update token/cost from metrics.usage events
    if (event.type === 'metrics.usage' && event.data) {
      const tokens = typeof event.data['tokens'] === 'number' ? event.data['tokens'] : 0;
      const cost = typeof event.data['cost'] === 'number' ? event.data['cost'] : 0;
      const projectId = event.project_id ?? (event.data['project_id'] as string | undefined);
      const modelId = event.model_id ?? (event.data['model_id'] as string | undefined);
      this.db.prepare(`
        UPDATE sessions
        SET total_tokens = total_tokens + ?,
            total_cost_usd = total_cost_usd + ?,
            project_id = COALESCE(project_id, ?),
            model_id = COALESCE(model_id, ?)
        WHERE session_id = ?
      `).run(tokens, cost, projectId ?? null, modelId ?? null, event.session_id);
    }

    // Handle high-level Task/Activity events
    if (event.type === 'task.sync' && event.data) {
      this.upsertTask(event.data);
    }
    if (event.type === 'task.snapshot' && Array.isArray(event.data?.['tasks'])) {
      this.syncTaskSnapshot(
        event.data['tasks'] as any[],
        Array.isArray(event.data['source_paths']) ? event.data['source_paths'] as string[] : [],
      );
    }
    if (event.type === 'goal.snapshot' && Array.isArray(event.data?.['goals'])) {
      this.syncGoalSnapshot(
        event.data['goals'] as any[],
        Array.isArray(event.data['source_paths']) ? event.data['source_paths'] as string[] : [],
      );
    }
    if (event.type === 'activity.new' && event.data) {
      this.upsertActivity(event.data);
    }
    if (event.type === 'notification.new' && event.data) {
      this.upsertNotification(event.data);
    }

    this.updateAgentRuntimeState(event);
  }

  private upsertTask(task: any): void {
    const tagsStr = typeof task.tags === 'string'
      ? task.tags
      : task.tags
        ? JSON.stringify(task.tags)
        : null;
    const metaStr = typeof task.metadata === 'string'
      ? task.metadata
      : task.metadata
        ? JSON.stringify(task.metadata)
        : null;
    const now = Math.floor(Date.now() / 1000);
    const nextStatus = task.status ?? 'inbox';
    const nextUpdatedAt = task.updated_at ?? now;

    // Check current state to detect changes
    const current = this.db.prepare(`
      SELECT assigned_to, status, started_at, checkout_agent_id FROM tasks WHERE id = ?
    `).get(task.id) as {
      assigned_to: string | null;
      status: string;
      started_at: number | null;
      checkout_agent_id: string | null;
    } | undefined;

    const startedAt = typeof task.started_at === 'number'
      ? task.started_at
      : nextStatus === 'in_progress'
        ? current?.status === 'in_progress' && current.started_at
          ? current.started_at
          : nextUpdatedAt
        : null;
    const shouldReleaseCheckout = nextStatus === 'done' || nextStatus === 'review';
    const checkoutAgentId = shouldReleaseCheckout
      ? null
      : task.checkout_agent_id ?? current?.checkout_agent_id ?? null;
    const checkoutAt = shouldReleaseCheckout
      ? null
      : task.checkout_at ?? null;

    this.db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, project, goal_id, assigned_to,
        checkout_agent_id, checkout_at, created_by, created_at, started_at,
        updated_at, due_date, source_path, tags, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        project = excluded.project,
        goal_id = excluded.goal_id,
        assigned_to = excluded.assigned_to,
        checkout_agent_id = excluded.checkout_agent_id,
        checkout_at = excluded.checkout_at,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        due_date = excluded.due_date,
        source_path = COALESCE(excluded.source_path, tasks.source_path),
        tags = excluded.tags,
        metadata = excluded.metadata
    `).run(
      task.id,
      task.title,
      task.description ?? null,
      nextStatus,
      task.priority ?? 'medium',
      task.project ?? null,
      task.goal_id ?? null,
      task.assigned_to ?? null,
      checkoutAgentId,
      checkoutAt,
      task.created_by ?? null,
      task.created_at ?? now,
      startedAt,
      nextUpdatedAt,
      task.due_date ?? null,
      task.source_path ?? null,
      tagsStr,
      metaStr,
    );

    if (task.source_path && Array.isArray(task.dependencies)) {
      this.replaceTaskDependencies(task.id, task.dependencies, task.source_path);
    }

    // Notify on assignment change
    if (task.assigned_to && task.assigned_to !== current?.assigned_to) {
      this.upsertNotification({
        recipient: task.assigned_to,
        type: 'assignment',
        title: 'New Task Assigned',
        message: `You have been assigned to: ${task.title}`,
        source_type: 'task',
        source_id: task.id
      });
    }

    // Notify on status change to 'review'
    if (nextStatus === 'review' && nextStatus !== current?.status) {
      this.upsertNotification({
        recipient: 'observatory', // Broadcast to system or manager
        type: 'status_change',
        title: 'Task Ready for Review',
        message: `Task "${task.title}" is ready for review by ${task.assigned_to}`,
        source_type: 'task',
        source_id: task.id,
      });
    }
  }

  private syncTaskSnapshot(tasks: any[], sourcePaths: string[]): void {
    if (sourcePaths.length > 0) {
      const placeholders = sourcePaths.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM tasks
        WHERE source_path IS NOT NULL
          AND source_path NOT IN (${placeholders})
      `).run(...sourcePaths);
      this.db.prepare(`
        DELETE FROM task_relations
        WHERE source_path IS NOT NULL
          AND source_path NOT IN (${placeholders})
      `).run(...sourcePaths);
    } else {
      this.db.prepare(`DELETE FROM tasks WHERE source_path IS NOT NULL`).run();
      this.db.prepare(`DELETE FROM task_relations WHERE source_path IS NOT NULL`).run();
    }

    const bySourcePath = new Map<string, any[]>();
    for (const task of tasks) {
      if (!task || typeof task !== 'object' || typeof task['id'] !== 'string') {
        continue;
      }
      const sourcePath = typeof task['source_path'] === 'string' ? task['source_path'] : '__snapshot__';
      const bucket = bySourcePath.get(sourcePath);
      if (bucket) {
        bucket.push(task);
      } else {
        bySourcePath.set(sourcePath, [task]);
      }
    }

    for (const [sourcePath, sourceTasks] of bySourcePath.entries()) {
      const ids = sourceTasks.map((task) => task.id);
      if (ids.length === 0) {
        this.db.prepare(`DELETE FROM tasks WHERE source_path = ?`).run(sourcePath);
        this.db.prepare(`DELETE FROM task_relations WHERE source_path = ?`).run(sourcePath);
        continue;
      }

      const placeholders = ids.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM tasks
        WHERE source_path = ?
          AND id NOT IN (${placeholders})
      `).run(sourcePath, ...ids);

      for (const task of sourceTasks) {
        this.upsertTask(task);
      }
    }
  }

  private syncGoalSnapshot(goals: any[], sourcePaths: string[]): void {
    if (sourcePaths.length > 0) {
      const placeholders = sourcePaths.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM goals
        WHERE source_path IS NOT NULL
          AND source_path NOT IN (${placeholders})
      `).run(...sourcePaths);
    } else {
      this.db.prepare(`DELETE FROM goals WHERE source_path IS NOT NULL`).run();
    }

    const bySourcePath = new Map<string, any[]>();
    for (const goal of goals) {
      if (!goal || typeof goal !== 'object' || typeof goal['id'] !== 'string') {
        continue;
      }
      const sourcePath = typeof goal['source_path'] === 'string' ? goal['source_path'] : '__snapshot__';
      const bucket = bySourcePath.get(sourcePath);
      if (bucket) {
        bucket.push(goal);
      } else {
        bySourcePath.set(sourcePath, [goal]);
      }
    }

    for (const [sourcePath, sourceGoals] of bySourcePath.entries()) {
      const ids = sourceGoals.map((goal) => goal.id);
      if (ids.length === 0) {
        this.db.prepare(`DELETE FROM goals WHERE source_path = ?`).run(sourcePath);
        continue;
      }

      const placeholders = ids.map(() => '?').join(', ');
      this.db.prepare(`
        DELETE FROM goals
        WHERE source_path = ?
          AND id NOT IN (${placeholders})
      `).run(sourcePath, ...ids);

      for (const goal of sourceGoals) {
        this.upsertGoal(goal);
      }
    }
  }

  private upsertGoal(goal: any): void {
    this.db.prepare(`
      INSERT INTO goals (id, title, description, level, parent_id, status, source_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        level = excluded.level,
        parent_id = excluded.parent_id,
        status = excluded.status,
        source_path = excluded.source_path
    `).run(
      goal.id,
      goal.title,
      goal.description ?? null,
      typeof goal.level === 'number' ? goal.level : 0,
      goal.parent_id ?? null,
      goal.status ?? 'active',
      goal.source_path ?? null,
    );
  }

  private replaceTaskDependencies(taskId: string, dependencies: string[], sourcePath: string): void {
    this.db.prepare(`
      DELETE FROM task_relations
      WHERE source_path = ?
        AND (
          (task_id = ? AND type = 'blocked_by')
          OR (related_task_id = ? AND type = 'blocks')
        )
    `).run(sourcePath, taskId, taskId);

    const insert = this.db.prepare(`
      INSERT INTO task_relations (id, type, task_id, related_task_id, source_path)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_path = excluded.source_path
    `);

    for (const dependencyId of dependencies) {
      insert.run(makeRelationId('blocked_by', taskId, dependencyId), 'blocked_by', taskId, dependencyId, sourcePath);
      insert.run(makeRelationId('blocks', dependencyId, taskId), 'blocks', dependencyId, taskId, sourcePath);
    }
  }

  private upsertActivity(activity: any): void {
    const dataStr = activity.data ? JSON.stringify(activity.data) : null;

    this.db.prepare(`
      INSERT INTO activities (id, type, actor_type, entity_type, entity_id, actor, description, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        actor_type = excluded.actor_type,
        actor = excluded.actor,
        description = excluded.description,
        data = excluded.data
    `).run(
      activity.id,
      activity.type,
      activity.actor_type ?? 'system',
      activity.entity_type,
      activity.entity_id ?? null,
      activity.actor ?? null,
      activity.description ?? null,
      dataStr,
      activity.created_at ?? Math.floor(Date.now() / 1000),
    );
  }

  private upsertNotification(notif: any): void {
    this.db.prepare(`
      INSERT INTO notifications (id, recipient, type, title, message, source_type, source_id, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        read_at = excluded.read_at
    `).run(
      notif.id || `notif_${Math.random().toString(36).slice(2, 11)}`,
      notif.recipient,
      notif.type,
      notif.title,
      notif.message ?? null,
      notif.source_type ?? null,
      notif.source_id ?? null,
      notif.read_at ?? null,
      notif.created_at ?? Math.floor(Date.now() / 1000)
    );
  }

  private upsertAgentProfile(profile: {
    agent_id: string;
    agent_name: string;
    budget_monthly_cents?: number;
  }): void {
    this.db.prepare(`
      INSERT INTO agent_profiles (agent_id, agent_name, budget_monthly_cents, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        agent_name = excluded.agent_name,
        budget_monthly_cents = COALESCE(excluded.budget_monthly_cents, agent_profiles.budget_monthly_cents),
        updated_at = excluded.updated_at
    `).run(
      profile.agent_id,
      profile.agent_name,
      profile.budget_monthly_cents ?? null,
      new Date().toISOString(),
    );
  }

  private updateAgentRuntimeState(event: UAEPEvent): void {
    const existing = this.db.prepare(`
      SELECT total_tokens, total_cost_usd, last_error, last_run_status, context_window_usage,
             recent_tool_call_count, tool_call_success_rate, health_status
      FROM agent_runtime_state
      WHERE agent_id = ?
    `).get(event.agent_id) as {
      total_tokens: number;
      total_cost_usd: number;
      last_error: string | null;
      last_run_status: string | null;
      context_window_usage: number | null;
      recent_tool_call_count: number;
      tool_call_success_rate: number | null;
      health_status: string | null;
    } | undefined;

    let totalTokens = existing?.total_tokens ?? 0;
    let totalCost = existing?.total_cost_usd ?? 0;
    let lastError = existing?.last_error ?? null;
    let lastRunStatus = existing?.last_run_status ?? 'idle';
    let contextWindowUsage = existing?.context_window_usage ?? null;
    let recentToolCallCount = existing?.recent_tool_call_count ?? 0;
    let toolCallSuccessRate = existing?.tool_call_success_rate ?? 1;

    if (event.type === 'metrics.usage') {
      totalTokens += typeof event.data?.['tokens'] === 'number' ? event.data['tokens'] as number : 0;
      totalCost += typeof event.data?.['cost'] === 'number' ? event.data['cost'] as number : 0;
      const usage = event.data?.['context_window_usage'];
      if (typeof usage === 'number') {
        contextWindowUsage = usage;
      }
    }

    if (event.type === 'tool.start') {
      lastRunStatus = 'running';
    }

    if (event.type === 'tool.end' || event.type === 'tool.error') {
      const previousSuccesses = Math.max(Math.round(toolCallSuccessRate * recentToolCallCount), 0);
      const nextCount = Math.min(recentToolCallCount + 1, 25);
      const nextSuccesses = event.type === 'tool.end'
        ? Math.min(previousSuccesses + 1, nextCount)
        : previousSuccesses;
      recentToolCallCount = nextCount;
      toolCallSuccessRate = nextCount > 0 ? nextSuccesses / nextCount : 1;
      lastRunStatus = event.type === 'tool.end' ? 'completed' : 'error';
      if (event.type === 'tool.error') {
        lastError = typeof event.data?.['error'] === 'string' ? event.data['error'] as string : lastError;
      }
    }

    if (event.type === 'agent.status') {
      const status = event.data?.['status'];
      if (typeof status === 'string') {
        lastRunStatus = status === 'waiting_permission' || status === 'waiting_input'
          ? 'waiting'
          : status === 'error'
            ? 'error'
            : status === 'idle'
              ? 'idle'
              : lastRunStatus;
      }
      const usage = event.data?.['context_window_usage'];
      if (typeof usage === 'number') {
        contextWindowUsage = usage;
      }
    }

    const healthStatus = lastRunStatus === 'error' || (contextWindowUsage ?? 0) >= 0.95
      ? 'error'
      : (contextWindowUsage ?? 0) >= 0.8 || toolCallSuccessRate < 0.75
        ? 'caution'
        : 'normal';

    this.db.prepare(`
      INSERT INTO agent_runtime_state (
        agent_id,
        total_tokens,
        total_cost_usd,
        last_error,
        last_run_status,
        context_window_usage,
        recent_tool_call_count,
        tool_call_success_rate,
        health_status,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        total_tokens = excluded.total_tokens,
        total_cost_usd = excluded.total_cost_usd,
        last_error = excluded.last_error,
        last_run_status = excluded.last_run_status,
        context_window_usage = excluded.context_window_usage,
        recent_tool_call_count = excluded.recent_tool_call_count,
        tool_call_success_rate = excluded.tool_call_success_rate,
        health_status = excluded.health_status,
        updated_at = excluded.updated_at
    `).run(
      event.agent_id,
      totalTokens,
      totalCost,
      lastError,
      lastRunStatus,
      contextWindowUsage,
      recentToolCallCount,
      toolCallSuccessRate,
      healthStatus,
      new Date().toISOString(),
    );
  }

  setAgentBudget(agentId: string, budgetMonthlyCents: number, agentName = agentId): void {
    this.upsertAgentProfile({
      agent_id: agentId,
      agent_name: agentName,
      budget_monthly_cents: budgetMonthlyCents,
    });
  }

  listTaskComments(taskId: string): TaskComment[] {
    return this.db.prepare(`
      SELECT id, task_id, author_agent_id, body, created_at
      FROM task_comments
      WHERE task_id = ?
      ORDER BY created_at ASC
    `).all(taskId) as TaskComment[];
  }

  addTaskComment(taskId: string, authorAgentId: string, body: string): TaskComment {
    const comment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      task_id: taskId,
      author_agent_id: authorAgentId,
      body,
      created_at: Math.floor(Date.now() / 1000),
    };

    this.db.prepare(`
      INSERT INTO task_comments (id, task_id, author_agent_id, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(comment.id, comment.task_id, comment.author_agent_id, comment.body, comment.created_at);

    return comment;
  }

  getGoalProgress(): GoalProgress[] {
    const goals = this.db.prepare(`
      SELECT id, title, description, level, parent_id, status, source_path
      FROM goals
      ORDER BY level ASC, title ASC
    `).all() as Array<Goal & { source_path: string | null }>;

    const taskRows = this.db.prepare(`
      SELECT goal_id, status, project
      FROM tasks
      WHERE goal_id IS NOT NULL
    `).all() as Array<{
      goal_id: string;
      status: string;
      project: string | null;
    }>;

    const byGoal = new Map<string, GoalProgress>();
    const childIds = new Map<string, string[]>();

    for (const goal of goals) {
      byGoal.set(goal.id, {
        id: goal.id,
        title: goal.title,
        description: goal.description ?? undefined,
        level: goal.level,
        parent_id: goal.parent_id ?? undefined,
        status: goal.status as Goal['status'],
        source_path: goal.source_path ?? undefined,
        total_tasks: 0,
        completed_tasks: 0,
        active_tasks: 0,
        completion_ratio: 0,
        projects: [],
        children: [],
      });

      if (goal.parent_id) {
        const siblings = childIds.get(goal.parent_id);
        if (siblings) {
          siblings.push(goal.id);
        } else {
          childIds.set(goal.parent_id, [goal.id]);
        }
      }
    }

    for (const row of taskRows) {
      const goal = byGoal.get(row.goal_id);
      if (!goal) continue;
      goal.total_tasks += 1;
      goal.completed_tasks += isCompletedTaskStatus(row.status) ? 1 : 0;
      goal.active_tasks += isCompletedTaskStatus(row.status) ? 0 : 1;
      if (row.project && !goal.projects.includes(row.project)) {
        goal.projects.push(row.project);
      }
    }

    const aggregate = (goalId: string): GoalProgress => {
      const goal = byGoal.get(goalId)!;
      for (const childId of childIds.get(goalId) ?? []) {
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
      goal.completion_ratio = goal.total_tasks > 0
        ? goal.completed_tasks / goal.total_tasks
        : 0;
      goal.projects.sort((left, right) => left.localeCompare(right));
      return goal;
    };

    const roots = goals
      .filter((goal) => !goal.parent_id || !byGoal.has(goal.parent_id))
      .map((goal) => aggregate(goal.id));

    return roots.sort((left, right) => left.title.localeCompare(right.title));
  }

  getByAgent(
    agentId: string,
    options?: { limit?: number; offset?: number; type?: string },
  ): UAEPEvent[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    const type = options?.type;

    let rows: unknown[];
    if (type) {
      rows = this.db.prepare(`
        SELECT * FROM events WHERE agent_id = ? AND type = ? ORDER BY ts ASC LIMIT ? OFFSET ?
      `).all(agentId, type, limit, offset);
    } else {
      rows = this.db.prepare(`
        SELECT * FROM events WHERE agent_id = ? ORDER BY ts ASC LIMIT ? OFFSET ?
      `).all(agentId, limit, offset);
    }

    return rows.map((row) => this.rowToEvent(row as EventRow));
  }

  getBySession(sessionId: string): UAEPEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC
    `).all(sessionId);

    return rows.map((row) => this.rowToEvent(row as EventRow));
  }

  getAgentEventCount(agentId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM events WHERE agent_id = ?
    `).get(agentId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  getSessionIds(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT session_id FROM events ORDER BY session_id
    `).all() as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }

  /** Full-text search across events */
  search(
    query: string,
    options?: { limit?: number; offset?: number },
  ): UAEPEvent[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Wrap query in double quotes to handle special FTS5 chars (dots, hyphens)
    const safeQuery = `"${query.replace(/"/g, '""')}"`;

    const rows = this.db.prepare(`
      SELECT e.* FROM events e
      JOIN events_fts fts ON e.id = fts.rowid
      WHERE events_fts MATCH ?
      ORDER BY e.ts DESC
      LIMIT ? OFFSET ?
    `).all(safeQuery, limit, offset);

    return rows.map((row) => this.rowToEvent(row as EventRow));
  }

  /** Get total count of search results */
  searchCount(query: string): number {
    const safeQuery = `"${query.replace(/"/g, '""')}"`;
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM events e
      JOIN events_fts fts ON e.id = fts.rowid
      WHERE events_fts MATCH ?
    `).get(safeQuery) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /** Get session summaries from the sessions table */
  getSessionSummaries(): SessionRow[] {
    return this.db.prepare(`
      SELECT * FROM sessions ORDER BY start_time DESC
    `).all() as SessionRow[];
  }

  /** Get a single session by ID */
  getSession(sessionId: string): SessionRow | undefined {
    return this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `).get(sessionId) as SessionRow | undefined;
  }

  /** Get session replay events with optional filters */
  getSessionReplay(
    sessionId: string,
    opts?: { from?: string; to?: string; types?: string[]; limit?: number; offset?: number },
  ): UAEPEvent[] {
    const conditions = ['session_id = ?'];
    const params: unknown[] = [sessionId];

    if (opts?.from) {
      conditions.push('ts >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('ts <= ?');
      params.push(opts.to);
    }
    if (opts?.types && opts.types.length > 0) {
      const placeholders = opts.types.map(() => '?').join(', ');
      conditions.push(`type IN (${placeholders})`);
      params.push(...opts.types);
    }

    const where = conditions.join(' AND ');
    let sql = `SELECT * FROM events WHERE ${where} ORDER BY ts ASC`;

    if (opts?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
      if (opts?.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(opts.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((row) => this.rowToEvent(row as EventRow));
  }

  /** Get event type counts for a session */
  getSessionEventTypeCounts(sessionId: string): Record<string, number> {
    const rows = this.db.prepare(`
      SELECT type, COUNT(*) as cnt FROM events WHERE session_id = ? GROUP BY type
    `).all(sessionId) as { type: string; cnt: number }[];

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.type] = row.cnt;
    }
    return counts;
  }

  /** Get total tool.start count for a session */
  getSessionToolCallCount(sessionId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND type = 'tool.start'
    `).get(sessionId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  /** Get cost summary across sessions */
  getCostSummary(opts?: { from?: string; to?: string }): {
    total_cost_usd: number;
    total_tokens: number;
    total_sessions: number;
  } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('start_time >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('start_time <= ?');
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COUNT(*) as total_sessions
      FROM sessions ${where}
    `).get(...params) as { total_cost_usd: number; total_tokens: number; total_sessions: number };

    return row;
  }

  /** Get cost grouped by agent */
  getCostByAgent(opts?: { from?: string; to?: string }): {
    agent_id: string;
    agent_name: string;
    source: string;
    total_cost_usd: number;
    total_tokens: number;
    session_count: number;
  }[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('start_time >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('start_time <= ?');
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT agent_id, agent_name, source,
             COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COUNT(*) as session_count
      FROM sessions ${where}
      GROUP BY agent_id
      ORDER BY total_cost_usd DESC
    `).all(...params) as {
      agent_id: string;
      agent_name: string;
      source: string;
      total_cost_usd: number;
      total_tokens: number;
      session_count: number;
    }[];
  }

  /** Get cost grouped by project (excludes sessions without project_id) */
  getCostByProject(opts?: { from?: string; to?: string }): {
    project_id: string;
    total_cost_usd: number;
    total_tokens: number;
    session_count: number;
    agent_count: number;
  }[] {
    const conditions = ['project_id IS NOT NULL'];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('start_time >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('start_time <= ?');
      params.push(opts.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.db.prepare(`
      SELECT project_id,
             COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COUNT(*) as session_count,
             COUNT(DISTINCT agent_id) as agent_count
      FROM sessions ${where}
      GROUP BY project_id
      ORDER BY total_cost_usd DESC, project_id ASC
    `).all(...params) as {
      project_id: string;
      total_cost_usd: number;
      total_tokens: number;
      session_count: number;
      agent_count: number;
    }[];
  }

  /** Get cost grouped by model (excludes sessions without model_id) */
  getCostByModel(opts?: { from?: string; to?: string }): {
    model_id: string;
    total_cost_usd: number;
    total_tokens: number;
    session_count: number;
    agent_count: number;
  }[] {
    const conditions = ['model_id IS NOT NULL'];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('start_time >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('start_time <= ?');
      params.push(opts.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.db.prepare(`
      SELECT model_id,
             COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COUNT(*) as session_count,
             COUNT(DISTINCT agent_id) as agent_count
      FROM sessions ${where}
      GROUP BY model_id
      ORDER BY total_cost_usd DESC, model_id ASC
    `).all(...params) as {
      model_id: string;
      total_cost_usd: number;
      total_tokens: number;
      session_count: number;
      agent_count: number;
    }[];
  }

  /** Get cost grouped by team (excludes sessions without team_id) */
  getCostByTeam(opts?: { from?: string; to?: string }): {
    team_id: string;
    total_cost_usd: number;
    total_tokens: number;
    agent_count: number;
    session_count: number;
  }[] {
    const conditions = ['team_id IS NOT NULL'];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('start_time >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('start_time <= ?');
      params.push(opts.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.db.prepare(`
      SELECT team_id,
             COALESCE(SUM(total_cost_usd), 0) as total_cost_usd,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COUNT(DISTINCT agent_id) as agent_count,
             COUNT(*) as session_count
      FROM sessions ${where}
      GROUP BY team_id
      ORDER BY total_cost_usd DESC
    `).all(...params) as {
      team_id: string;
      total_cost_usd: number;
      total_tokens: number;
      agent_count: number;
      session_count: number;
    }[];
  }

  /** Get cost timeseries from metrics.usage events (minute buckets) */
  getCostTimeseries(opts?: { from?: string; to?: string }): {
    ts: string;
    cost: number;
    tokens: number;
  }[] {
    const conditions = ["type = 'metrics.usage'"];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('ts >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('ts <= ?');
      params.push(opts.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.db.prepare(`
      SELECT strftime('%Y-%m-%dT%H:%M:00Z', ts) as ts,
             COALESCE(SUM(CAST(json_extract(data, '$.cost') AS REAL)), 0) as cost,
             COALESCE(SUM(CAST(json_extract(data, '$.tokens') AS INTEGER)), 0) as tokens
      FROM events ${where}
      GROUP BY strftime('%Y-%m-%dT%H:%M:00Z', ts)
      ORDER BY ts ASC
    `).all(...params) as { ts: string; cost: number; tokens: number }[];
  }

  /** Get tool call distribution from tool.start events */
  getToolCallDistribution(opts?: { from?: string; to?: string }): {
    tool_name: string;
    count: number;
  }[] {
    const conditions = ["type = 'tool.start'"];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('ts >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('ts <= ?');
      params.push(opts.to);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    return this.db.prepare(`
      SELECT json_extract(data, '$.tool_name') as tool_name,
             COUNT(*) as count
      FROM events ${where}
      GROUP BY tool_name
      ORDER BY count DESC
    `).all(...params) as { tool_name: string; count: number }[];
  }

  /** Get tokens grouped by agent from sessions table */
  getTokensByAgent(opts?: { from?: string; to?: string }): {
    agent_id: string;
    agent_name: string;
    total_tokens: number;
  }[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts?.from) {
      conditions.push('start_time >= ?');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('start_time <= ?');
      params.push(opts.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT agent_id, agent_name,
             COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM sessions ${where}
      GROUP BY agent_id
      ORDER BY total_tokens DESC
    `).all(...params) as { agent_id: string; agent_name: string; total_tokens: number }[];
  }

  getBudgetAlerts(opts?: {
    monthStart?: string;
    monthEnd?: string;
    warningThreshold?: number;
  }): {
    agent_id: string;
    agent_name: string;
    budget_monthly_cents: number;
    spent_monthly_cents: number;
    spent_monthly_usd: number;
    utilization_ratio: number;
    severity: 'warning' | 'critical';
  }[] {
    const now = new Date();
    const monthStart = opts?.monthStart
      ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const monthEnd = opts?.monthEnd
      ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const warningThreshold = opts?.warningThreshold ?? 0.8;

    const rows = this.db.prepare(`
      SELECT ap.agent_id,
             ap.agent_name,
             ap.budget_monthly_cents,
             COALESCE(CAST(ROUND(SUM(s.total_cost_usd) * 100) AS INTEGER), 0) as spent_monthly_cents,
             COALESCE(SUM(s.total_cost_usd), 0) as spent_monthly_usd
      FROM agent_profiles ap
      LEFT JOIN sessions s
        ON s.agent_id = ap.agent_id
       AND s.start_time >= ?
       AND s.start_time < ?
      WHERE ap.budget_monthly_cents IS NOT NULL
        AND ap.budget_monthly_cents > 0
      GROUP BY ap.agent_id, ap.agent_name, ap.budget_monthly_cents
    `).all(monthStart, monthEnd) as {
      agent_id: string;
      agent_name: string;
      budget_monthly_cents: number;
      spent_monthly_cents: number;
      spent_monthly_usd: number;
    }[];

    return rows
      .map((row) => {
        const utilizationRatio = row.budget_monthly_cents > 0
          ? row.spent_monthly_cents / row.budget_monthly_cents
          : 0;
        if (utilizationRatio < warningThreshold) {
          return null;
        }
        return {
          ...row,
          utilization_ratio: utilizationRatio,
          severity: utilizationRatio >= 1 ? 'critical' as const : 'warning' as const,
        };
      })
      .filter((row): row is {
        agent_id: string;
        agent_name: string;
        budget_monthly_cents: number;
        spent_monthly_cents: number;
        spent_monthly_usd: number;
        utilization_ratio: number;
        severity: 'warning' | 'critical';
      } => row !== null)
      .sort((a, b) => b.utilization_ratio - a.utilization_ratio);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }

  private rowToEvent(row: EventRow): UAEPEvent {
    return {
      ts: row.ts,
      event_id: row.event_id,
      source: row.source as UAEPEvent['source'],
      agent_id: row.agent_id,
      session_id: row.session_id,
      span_id: row.span_id ?? undefined,
      parent_span_id: row.parent_span_id ?? undefined,
      team_id: row.team_id ?? undefined,
      type: row.type as UAEPEvent['type'],
      data: row.data ? JSON.parse(row.data) as Record<string, unknown> : undefined,
    };
  }
}

interface EventRow {
  id: number;
  event_id: string;
  ts: string;
  type: string;
  source: string;
  agent_id: string;
  session_id: string;
  span_id: string | null;
  parent_span_id: string | null;
  team_id: string | null;
  data: string | null;
}

interface SessionRow {
  session_id: string;
  agent_id: string;
  agent_name: string;
  source: string;
  team_id: string | null;
  project_id: string | null;
  model_id: string | null;
  start_time: string;
  end_time: string | null;
  total_events: number;
  total_tokens: number;
  total_cost_usd: number;
}

export type { SessionRow };
