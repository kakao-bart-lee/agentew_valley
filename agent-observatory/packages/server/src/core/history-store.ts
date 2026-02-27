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
