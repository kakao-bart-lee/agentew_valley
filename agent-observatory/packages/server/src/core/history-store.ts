import Database from 'better-sqlite3';
import type { UAEPEvent } from '@agent-observatory/shared';

export class HistoryStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');
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
        assigned_to TEXT, -- agent_id
        created_by TEXT,
        created_at INTEGER NOT NULL, -- Unix timestamp
        updated_at INTEGER NOT NULL, -- Unix timestamp
        due_date INTEGER,
        tags TEXT, -- JSON array
        metadata TEXT -- JSON object
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- task_created | task_updated | comment_added | agent_status_change ...
        entity_type TEXT NOT NULL, -- task | agent | comment
        entity_id TEXT,
        actor TEXT, -- Who performed the action
        description TEXT, -- Human readable description
        data TEXT, -- JSON context
        created_at INTEGER NOT NULL -- Unix timestamp
      );
      CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);

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

    this.initFTS();
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
      this.db.prepare(`
        INSERT OR IGNORE INTO sessions (session_id, agent_id, agent_name, source, team_id, start_time, total_events, total_tokens, total_cost_usd)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
      `).run(
        event.session_id,
        event.agent_id,
        event.agent_name ?? event.agent_id,
        event.source,
        event.team_id ?? null,
        event.ts,
      );
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
      if (tokens > 0 || cost > 0) {
        this.db.prepare(`
          UPDATE sessions SET total_tokens = total_tokens + ?, total_cost_usd = total_cost_usd + ? WHERE session_id = ?
        `).run(tokens, cost, event.session_id);
      }
    }

    // Handle high-level Task/Activity events
    if (event.type === 'task.sync' && event.data) {
      this.upsertTask(event.data);
    }
    if (event.type === 'activity.new' && event.data) {
      this.upsertActivity(event.data);
    }
    if (event.type === 'notification.new' && event.data) {
      this.upsertNotification(event.data);
    }
  }

  private upsertTask(task: any): void {
    const tagsStr = task.tags ? JSON.stringify(task.tags) : null;
    const metaStr = task.metadata ? JSON.stringify(task.metadata) : null;

    // Check current state to detect changes
    const current = this.db.prepare(`SELECT assigned_to, status FROM tasks WHERE id = ?`).get(task.id) as { assigned_to: string, status: string } | undefined;

    this.db.prepare(`
      INSERT INTO tasks (id, title, description, status, priority, assigned_to, created_by, created_at, updated_at, due_date, tags, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        assigned_to = excluded.assigned_to,
        updated_at = excluded.updated_at,
        due_date = excluded.due_date,
        tags = excluded.tags,
        metadata = excluded.metadata
    `).run(
      task.id,
      task.title,
      task.description ?? null,
      task.status ?? 'inbox',
      task.priority ?? 'medium',
      task.assigned_to ?? null,
      task.created_by ?? null,
      task.created_at ?? Math.floor(Date.now() / 1000),
      task.updated_at ?? Math.floor(Date.now() / 1000),
      task.due_date ?? null,
      tagsStr,
      metaStr,
    );

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
    if (task.status === 'review' && task.status !== current?.status) {
       this.upsertNotification({
        recipient: 'observatory', // Broadcast to system or manager
        type: 'status_change',
        title: 'Task Ready for Review',
        message: `Task "${task.title}" is ready for review by ${task.assigned_to}`,
        source_type: 'task',
        source_id: task.id
      });
    }
  }

  private upsertActivity(activity: any): void {
    const dataStr = activity.data ? JSON.stringify(activity.data) : null;

    this.db.prepare(`
      INSERT INTO activities (id, type, entity_type, entity_id, actor, description, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        actor = excluded.actor,
        description = excluded.description,
        data = excluded.data
    `).run(
      activity.id,
      activity.type,
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
  start_time: string;
  end_time: string | null;
  total_events: number;
  total_tokens: number;
  total_cost_usd: number;
}

export type { SessionRow };
