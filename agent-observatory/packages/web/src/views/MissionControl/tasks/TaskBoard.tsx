import { useEffect, useState } from 'react';
import { TaskColumn } from './TaskColumn';

const KANBAN_COLUMNS = ['inbox', 'assigned', 'in_progress', 'review', 'quality_review', 'done'] as const;

interface McTask {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigned_to?: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  due_date?: number;
  tags?: string;
}

interface TasksResponse {
  tasks: McTask[];
  total: number;
  flag_enabled?: boolean;
  mc_db_connected?: boolean;
  code?: string;
  error?: string;
}

export function TaskBoard() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = (window as any).__OBSERVATORY_API__ ?? 'http://localhost:3000';
    fetch(`${apiBase}/api/v2/tasks?limit=200`)
      .then((r) => r.json())
      .then((d: TasksResponse) => { setData(d); setLoading(false); })
      .catch(() => { setData({ tasks: [], total: 0, error: 'Network error', code: 'NETWORK_ERROR' }); setLoading(false); });
  }, []);

  if (loading) {
    return <div className="text-slate-400 text-sm p-4">Loading tasks...</div>;
  }

  if (data?.code === 'V2_KILL_SWITCH_ENABLED') {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
        v2 Kill Switch 활성화됨 — 모든 v2 라우트가 비활성화되어 있습니다.
      </div>
    );
  }

  if (data?.code === 'FEATURE_FLAG_DISABLED') {
    return (
      <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 text-amber-300 text-sm">
        <strong>Feature flag 비활성화</strong>
        <p className="mt-1 text-amber-400/80">
          Tasks v2 기능이 비활성화되어 있습니다.
          <code className="ml-1 bg-amber-900/50 px-1 rounded">OBSERVATORY_TASKS_V2_ENABLED=true</code> 환경변수를 설정하고 서버를 재시작하세요.
        </p>
      </div>
    );
  }

  if (!data?.mc_db_connected) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 text-slate-400 text-sm">
        <strong className="text-slate-300">Mission Control DB 미연결</strong>
        <p className="mt-1">
          <code className="bg-slate-700 px-1 rounded">MISSION_CONTROL_DB_PATH</code> 환경변수를 Mission Control DB 경로로 설정하세요.
        </p>
      </div>
    );
  }

  const tasksByStatus = KANBAN_COLUMNS.reduce<Record<string, McTask[]>>((acc, col) => {
    acc[col] = (data?.tasks ?? []).filter((t) => t.status === col);
    return acc;
  }, {} as Record<string, McTask[]>);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          총 {data?.total ?? 0}개 태스크
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map((col) => (
          <TaskColumn key={col} status={col} tasks={tasksByStatus[col] ?? []} />
        ))}
      </div>
    </div>
  );
}
