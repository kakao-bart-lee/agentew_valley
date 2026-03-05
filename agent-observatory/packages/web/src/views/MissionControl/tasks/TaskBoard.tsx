import { useEffect, useMemo, useState } from 'react';
import type { GoalProgress, GoalsResponse, MissionControlTask, TasksResponse } from '@agent-observatory/shared';
import { TaskColumn } from './TaskColumn';
import { TaskDetailPanel } from './TaskDetailPanel';
import { fetchJsonWithAuth, getApiBase } from '../../../lib/api';
import { useMissionControlStore } from '../../../stores/missionControlStore';

const KANBAN_COLUMNS = ['inbox', 'assigned', 'in_progress', 'review', 'quality_review', 'done'] as const;
const STATUS_LABELS: Record<string, string> = {
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  quality_review: 'Quality Review',
  done: 'Done',
};

type GroupBy = 'status' | 'agent' | 'project';

interface TaskColumnData {
  key: string;
  title: string;
  accent: string;
  tasks: MissionControlTask[];
}

function formatProjectLabel(project?: string): string {
  if (!project) return 'Unscoped';
  if (project.startsWith('/')) {
    return project.split('/').filter(Boolean).pop() ?? project;
  }
  return project;
}

function flattenGoals(goals: GoalProgress[], depth = 0): Array<{ goal: GoalProgress; depth: number }> {
  return goals.flatMap((goal) => [
    { goal, depth },
    ...flattenGoals(goal.children, depth + 1),
  ]);
}

function collectGoalIds(goals: GoalProgress[], selectedGoalId: string): string[] {
  for (const goal of goals) {
    if (goal.id === selectedGoalId) {
      return [
        goal.id,
        ...goal.children.flatMap((child) => collectGoalIds([child], child.id)),
      ];
    }
    const nested = collectGoalIds(goal.children, selectedGoalId);
    if (nested.length > 0) {
      return nested;
    }
  }
  return [];
}

function buildColumns(tasks: MissionControlTask[], groupBy: GroupBy): TaskColumnData[] {
  if (groupBy === 'status') {
    return KANBAN_COLUMNS.map((status) => ({
      key: status,
      title: STATUS_LABELS[status] ?? status,
      accent: status,
      tasks: tasks.filter((task) => task.status === status),
    }));
  }

  const groups = new Map<string, MissionControlTask[]>();
  const fallbackKey = groupBy === 'agent' ? '__unassigned__' : '__unscoped__';

  for (const task of tasks) {
    const key = groupBy === 'agent'
      ? task.assigned_to || fallbackKey
      : task.project || fallbackKey;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(task);
    } else {
      groups.set(key, [task]);
    }
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      if (left === fallbackKey) return 1;
      if (right === fallbackKey) return -1;
      return left.localeCompare(right);
    })
    .map(([key, bucket]) => ({
      key,
      title: groupBy === 'agent'
        ? (key === fallbackKey ? 'Unassigned' : `@${key}`)
        : formatProjectLabel(key === fallbackKey ? undefined : key),
      accent: groupBy,
      tasks: [...bucket].sort((left, right) => right.updated_at - left.updated_at),
    }));
}

export function TaskBoard() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [goalsData, setGoalsData] = useState<GoalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [goalFilter, setGoalFilter] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const versions = useMissionControlStore((state) => state.versions);

  useEffect(() => {
    let cancelled = false;

    const load = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const [nextTasks, nextGoals] = await Promise.all([
          fetchJsonWithAuth<TasksResponse>(`${getApiBase()}/api/v2/tasks?limit=200`),
          fetchJsonWithAuth<GoalsResponse>(`${getApiBase()}/api/v2/goals`),
        ]);
        if (!cancelled) {
          setData(nextTasks);
          setGoalsData(nextGoals);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData({
            domain: 'tasks',
            version: 'v2',
            tasks: [],
            total: 0,
            mc_db_connected: false,
          });
          setGoalsData({
            domain: 'goals',
            version: 'v2',
            goals: [],
            total: 0,
            mc_db_connected: false,
          });
          setLoading(false);
        }
      }
    };

    void load(true);
    const intervalId = window.setInterval(() => {
      void load(false);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [versions.tasks, versions.goals]);

  const tasks = data?.tasks ?? [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  const flatGoals = useMemo(() => flattenGoals(goalsData?.goals ?? []), [goalsData?.goals]);
  const filteredGoalIds = useMemo(
    () => goalFilter === 'all' ? null : collectGoalIds(goalsData?.goals ?? [], goalFilter),
    [goalFilter, goalsData?.goals],
  );
  const projectOptions = Array.from(
    new Set(tasks.map((task) => task.project).filter((project): project is string => Boolean(project))),
  ).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (projectFilter !== 'all' && !projectOptions.includes(projectFilter)) {
      setProjectFilter('all');
    }
  }, [projectFilter, projectOptions]);

  useEffect(() => {
    if (goalFilter === 'all') return;
    if (!tasks.some((task) => task.goal_id === goalFilter) && !flatGoals.some(({ goal }) => goal.id === goalFilter)) {
      setGoalFilter('all');
    }
  }, [goalFilter, tasks, flatGoals]);

  const filteredTasks = tasks
    .filter((task) => projectFilter === 'all' || task.project === projectFilter)
    .filter((task) => {
      if (!filteredGoalIds) {
        return true;
      }
      return task.goal_id ? filteredGoalIds.includes(task.goal_id) : false;
    });

  const effectiveGroupBy = goalFilter !== 'all' && groupBy === 'status' ? 'project' : groupBy;
  const columns = buildColumns(filteredTasks, effectiveGroupBy);

  if (loading) {
    return <div className="p-4 text-sm text-slate-400">Loading tasks...</div>;
  }

  if (!data?.mc_db_connected) {
    return (
      <div className="rounded-lg border border-slate-600 bg-slate-800 p-4 text-sm text-slate-400">
        <strong className="text-slate-300">Mission Control DB 미연결</strong>
        <p className="mt-1">
          <code className="rounded bg-slate-700 px-1">MISSION_CONTROL_DB_PATH</code>
          환경변수를 Mission Control DB 경로로 설정하세요.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <span className="text-xs text-slate-500">
          총 {filteredTasks.length}개 태스크
          {goalFilter !== 'all' ? ' · goal scoped' : ''}
          {projectFilter !== 'all' ? ` · project: ${formatProjectLabel(projectFilter)}` : ''}
        </span>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 p-1">
            <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Group by</span>
            {(['status', 'agent', 'project'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setGroupBy(option)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  groupBy === option
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {option === 'status' ? 'Status' : option === 'agent' ? 'Agent' : 'Project'}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
            <span className="font-medium uppercase tracking-wide text-slate-500">Project</span>
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="min-w-[140px] bg-transparent text-slate-200 outline-none"
            >
              <option value="all">All projects</option>
              {projectOptions.map((project) => (
                <option key={project} value={project}>
                  {formatProjectLabel(project)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-100">Goal Drill-down</h3>
          <button
            type="button"
            onClick={() => setGoalFilter('all')}
            className="text-xs text-slate-400 transition-colors hover:text-slate-200"
          >
            Clear
          </button>
        </div>
        {flatGoals.length === 0 ? (
          <div className="text-sm text-slate-500">No goals synced yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {flatGoals.map(({ goal, depth }) => {
              const isActive = goalFilter === goal.id;
              return (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => setGoalFilter(goal.id)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-cyan-500 bg-cyan-950/40'
                      : 'border-slate-700 bg-slate-950/60 hover:border-slate-600'
                  }`}
                  style={{ marginLeft: depth * 12 }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{goal.title}</div>
                    <div className="text-[11px] text-slate-500">
                      {goal.completed_tasks}/{goal.total_tasks} complete
                    </div>
                  </div>
                  <div className="ml-3 h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-cyan-400"
                      style={{ width: `${Math.round(goal.completion_ratio * 100)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {columns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
              표시할 태스크가 없습니다.
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {columns.map((column) => (
                <TaskColumn
                  key={column.key}
                  title={column.title}
                  accent={column.accent}
                  tasks={column.tasks}
                  onSelectTask={(task) => setSelectedTaskId(task.id)}
                />
              ))}
            </div>
          )}
        </div>

        {selectedTask && (
          <TaskDetailPanel
            task={selectedTask}
            onClose={() => setSelectedTaskId(null)}
          />
        )}
      </div>
    </div>
  );
}
