import type { TaskContextRef, TaskContextSnapshot } from '@agent-observatory/shared';
import { coerceTaskContext } from '@agent-observatory/shared';
import type { HistoryStore } from './history-store.js';

interface BaseSessionRow {
  session_id: string;
  agent_id: string;
  project_id: string | null;
  task_id: string | null;
  goal_id: string | null;
  task_context: string | null;
}

interface TaskJoinRow {
  id: string;
  title: string | null;
  status: string | null;
  project: string | null;
  goal_id: string | null;
  goal_title: string | null;
  goal_status: string | null;
}

export interface TaskContextProvider {
  getSessionContext(sessionId: string): TaskContextSnapshot | undefined;
  getAgentContext(agentId: string): TaskContextSnapshot | undefined;
}

function parseTaskContext(value: string | null): TaskContextRef | undefined {
  if (!value) return undefined;
  return JSON.parse(value) as TaskContextRef;
}

function buildBaseTaskContext(row: BaseSessionRow): TaskContextRef | undefined {
  return parseTaskContext(row.task_context)
    ?? coerceTaskContext({
      project_id: row.project_id ?? undefined,
      task_id: row.task_id ?? undefined,
      goal_id: row.goal_id ?? undefined,
    });
}

export class HistoryStoreTaskContextProvider implements TaskContextProvider {
  constructor(private readonly historyStore: HistoryStore) {}

  getSessionContext(sessionId: string): TaskContextSnapshot | undefined {
    const db = this.historyStore.getDb();
    const row = db.prepare(`
      SELECT session_id, agent_id, project_id, task_id, goal_id, task_context
      FROM sessions
      WHERE session_id = ?
    `).get(sessionId) as BaseSessionRow | undefined;

    return row ? this.buildSnapshot(row, 'session') : undefined;
  }

  getAgentContext(agentId: string): TaskContextSnapshot | undefined {
    const db = this.historyStore.getDb();
    const row = db.prepare(`
      SELECT session_id, agent_id, project_id, task_id, goal_id, task_context
      FROM sessions
      WHERE agent_id = ?
      ORDER BY start_time DESC
      LIMIT 1
    `).get(agentId) as BaseSessionRow | undefined;

    return row ? this.buildSnapshot(row, 'agent') : undefined;
  }

  private buildSnapshot(
    row: BaseSessionRow,
    resolvedFrom: TaskContextSnapshot['resolved_from'],
  ): TaskContextSnapshot | undefined {
    const base = buildBaseTaskContext(row);
    if (!base) return undefined;

    const db = this.historyStore.getDb();
    const task = base.task_id
      ? db.prepare(`
        SELECT
          tasks.id,
          tasks.title,
          tasks.status,
          tasks.project,
          tasks.goal_id,
          goals.title AS goal_title,
          goals.status AS goal_status
        FROM tasks
        LEFT JOIN goals ON goals.id = tasks.goal_id
        WHERE tasks.id = ?
      `).get(base.task_id) as TaskJoinRow | undefined
      : undefined;

    return {
      ...base,
      provider: base.provider ?? 'history_store',
      session_id: row.session_id,
      agent_id: row.agent_id,
      resolved_from: task ? 'task' : resolvedFrom,
      task: task
        ? {
            id: task.id,
            title: task.title ?? undefined,
            status: task.status ?? undefined,
            project: task.project ?? undefined,
          }
        : base.task_id
          ? {
              id: base.task_id,
            }
          : undefined,
      goal: task?.goal_id
        ? {
            id: task.goal_id,
            title: task.goal_title ?? undefined,
            status: task.goal_status ?? undefined,
          }
        : base.goal_id
          ? {
              id: base.goal_id,
            }
          : undefined,
    };
  }
}
