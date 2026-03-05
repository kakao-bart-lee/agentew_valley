import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

let mcDb: Database.Database | null = null;
let mcDbPath: string | null = null;

function resolveDbPath(rawPath: string): string {
  return rawPath.startsWith('~')
    ? resolve(homedir(), rawPath.slice(2))
    : resolve(rawPath);
}

function ensureMissionControlSchema(db: Database.Database): void {
  const hasTasksTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'`)
    .get();

  if (!hasTasksTable) {
    console.warn('[mc-db] tasks table not found — may not be a Mission Control DB');
    return;
  }

  for (const column of [
    'project TEXT',
    'goal_id TEXT',
    'checkout_agent_id TEXT',
    'checkout_at INTEGER',
    'started_at INTEGER',
    'source_path TEXT',
  ]) {
    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${column}`);
    } catch {
      // Column already exists.
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_checkout ON tasks(checkout_agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_source_path ON tasks(source_path);

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      level INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      source_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parent_id);

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author_agent_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at);

    CREATE TABLE IF NOT EXISTS task_relations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      related_task_id TEXT NOT NULL,
      source_path TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_relations_task ON task_relations(task_id, type);
    CREATE INDEX IF NOT EXISTS idx_task_relations_related ON task_relations(related_task_id, type);

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
  `);
}

export function getMcDb(): Database.Database | null {
  return mcDb;
}

export function setMcDb(db: Database.Database): void {
  ensureMissionControlSchema(db);
  mcDb = db;
}

export function getMcDbPath(): string | null {
  return mcDbPath;
}

export function openMcDb(dbPath?: string): Database.Database | null {
  const rawPath = dbPath ?? process.env.MISSION_CONTROL_DB_PATH;
  if (!rawPath) return null;

  const resolvedPath = resolveDbPath(rawPath);

  try {
    const db = new Database(resolvedPath);
    ensureMissionControlSchema(db);
    mcDb = db;
    mcDbPath = resolvedPath;
    console.info(`[mc-db] Connected to Mission Control DB: ${resolvedPath}`);
    return db;
  } catch (err) {
    console.warn(`[mc-db] Failed to open MC DB at ${resolvedPath}:`, (err as Error).message);
    return null;
  }
}

export function closeMcDb(): void {
  if (mcDb) {
    try {
      mcDb.close();
    } catch {
      // The shared in-process DB may already be closed by HistoryStore.
    }
    mcDb = null;
    mcDbPath = null;
  }
}
