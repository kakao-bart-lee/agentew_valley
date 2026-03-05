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
    'checkout_agent_id TEXT',
    'checkout_at INTEGER',
    'started_at INTEGER',
  ]) {
    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${column}`);
    } catch {
      // Column already exists.
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_checkout ON tasks(checkout_agent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);
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
