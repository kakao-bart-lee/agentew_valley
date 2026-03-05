import { useEffect, useState } from 'react';
import { TaskColumn } from './TaskColumn';
import { fetchJsonWithAuth, getApiBase } from '../../../lib/api';

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

interface McTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  project?: string;
  assigned_to?: string;
  checkout_agent_id?: string;
  checkout_at?: number;
  created_by?: string;
  created_at: number;
  started_at?: number;
  updated_at: number;
  due_date?: number;
  tags?: string;
  metadata?: string;
  is_stale?: boolean;
}

interface TasksResponse {
  tasks: McTask[];
  total: number;
  flag_enabled?: boolean;
  mc_db_connected?: boolean;
  code?: string;
  error?: string;
}

interface TaskColumnData {
  key: string;
  title: string;
  accent: string;
  tasks: McTask[];
}

function formatProjectLabel(project?: string): string {
  if (!project) return 'Unscoped';
  if (project.startsWith('/')) {
    return project.split('/').filter(Boolean).pop() ?? project;
  }
  return project;
}

function buildColumns(tasks: McTask[], groupBy: GroupBy): TaskColumnData[] {
  if (groupBy === 'status') {
    return KANBAN_COLUMNS.map((status) => ({
      key: status,
      title: STATUS_LABELS[status] ?? status,
      accent: status,
      tasks: tasks.filter((task) => task.status === status),
    }));
  }

  const groups = new Map<string, McTask[]>();
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
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;

    const loadTasks = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const nextData = await fetchJsonWithAuth<TasksResponse>(
          `${getApiBase()}/api/v2/tasks?limit=200`,
        );
        if (!cancelled) {
          setData(nextData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData({ tasks: [], total: 0, error: 'Network error', code: 'NETWORK_ERROR' });
          setLoading(false);
        }
      }
    };

    void loadTasks(true);
    const intervalId = window.setInterval(() => {
      void loadTasks(false);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const tasks = data?.tasks ?? [];
  const projectOptions = Array.from(
    new Set(tasks.map((task) => task.project).filter((project): project is string => Boolean(project))),
  ).sort((left, right) => left.localeCompare(right));

  useEffect(() => {
    if (projectFilter === 'all') return;
    if (!projectOptions.includes(projectFilter)) {
      setProjectFilter('all');
    }
  }, [projectFilter, projectOptions]);

  const filteredTasks = projectFilter === 'all'
    ? tasks
    : tasks.filter((task) => task.project === projectFilter);
  const columns = buildColumns(filteredTasks, groupBy);

  if (loading) {
    return <div className="p-4 text-sm text-slate-400">Loading tasks...</div>;
  }

  if (data?.code === 'V2_KILL_SWITCH_ENABLED') {
    return (
      <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">
        v2 Kill Switch 활성화됨 - 모든 v2 라우트가 비활성화되어 있습니다.
      </div>
    );
  }

  if (data?.code === 'FEATURE_FLAG_DISABLED') {
    return (
      <div className="rounded-lg border border-amber-700 bg-amber-900/30 p-4 text-sm text-amber-300">
        <strong>Feature flag 비활성화</strong>
        <p className="mt-1 text-amber-400/80">
          Tasks v2 기능이 비활성화되어 있습니다.
          <code className="ml-1 rounded bg-amber-900/50 px-1">OBSERVATORY_TASKS_V2_ENABLED=true</code>
          환경변수를 설정하고 서버를 재시작하세요.
        </p>
      </div>
    );
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
          {projectFilter !== 'all' && data ? ` · project: ${formatProjectLabel(projectFilter)}` : ''}
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
