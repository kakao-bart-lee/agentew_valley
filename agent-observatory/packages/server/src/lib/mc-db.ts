import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

let mcDb: Database.Database | null = null;
let mcDbPath: string | null = null;

export function getMcDb(): Database.Database | null {
  return mcDb;
}

export function getMcDbPath(): string | null {
  return mcDbPath;
}

export function openMcDb(dbPath?: string): Database.Database | null {
  const rawPath = dbPath ?? process.env.MISSION_CONTROL_DB_PATH;
  if (!rawPath) return null;

  const resolvedPath = rawPath.startsWith('~')
    ? resolve(homedir(), rawPath.slice(2))
    : resolve(rawPath);

  try {
    const db = new Database(resolvedPath, { readonly: true });
    // Verify it's a valid MC DB by checking for tasks table
    const hasTasksTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'`)
      .get();
    if (!hasTasksTable) {
      console.warn('[mc-db] tasks table not found — may not be a Mission Control DB');
    }
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
    mcDb.close();
    mcDb = null;
    mcDbPath = null;
  }
}
