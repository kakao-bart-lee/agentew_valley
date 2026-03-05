import { useEffect, useState } from 'react';

interface McActivity {
  id: number;
  type: string;
  entity_type: string;
  entity_id: number;
  actor: string;
  description: string;
  data?: string;
  created_at: number;
}

interface ActivitiesResponse {
  activities: McActivity[];
  total: number;
  mc_db_connected?: boolean;
  code?: string;
  error?: string;
}

const ACTIVITY_TYPE_COLORS: Record<string, string> = {
  task_created: 'text-emerald-400',
  task_updated: 'text-blue-400',
  task_completed: 'text-emerald-400',
  comment_added: 'text-purple-400',
  agent_status_change: 'text-amber-400',
};

function formatRelativeTime(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function MCActivityFeed() {
  const [data, setData] = useState<ActivitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiBase = (window as any).__OBSERVATORY_API__ ?? 'http://localhost:3000';
    fetch(`${apiBase}/api/v2/activities?limit=50`)
      .then((r) => r.json())
      .then((d: ActivitiesResponse) => { setData(d); setLoading(false); })
      .catch(() => { setData({ activities: [], total: 0, error: 'Network error', code: 'NETWORK_ERROR' }); setLoading(false); });
  }, []);

  if (loading) return <div className="text-slate-400 text-sm p-4">Loading activities...</div>;

  if (data?.code === 'FEATURE_FLAG_DISABLED') {
    return (
      <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 text-amber-300 text-sm">
        Feature flag 비활성화 — <code className="bg-amber-900/50 px-1 rounded">OBSERVATORY_TASKS_V2_ENABLED=true</code> 설정이 필요합니다.
      </div>
    );
  }

  if (!data?.mc_db_connected) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 text-slate-400 text-sm">
        Mission Control DB 미연결 — <code className="bg-slate-700 px-1 rounded">MISSION_CONTROL_DB_PATH</code> 환경변수를 설정하세요.
      </div>
    );
  }

  const activities = data?.activities ?? [];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-slate-500">최근 {activities.length}개 활동</span>
      {activities.length === 0 && (
        <div className="text-slate-500 text-sm">활동 내역이 없습니다.</div>
      )}
      <div className="flex flex-col gap-1">
        {activities.map((activity) => {
          const typeColor = ACTIVITY_TYPE_COLORS[activity.type] ?? 'text-slate-400';
          return (
            <div key={activity.id} className="flex items-start gap-3 py-2 border-b border-slate-800">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${typeColor}`}>{activity.type}</span>
                  <span className="text-xs text-slate-500">{activity.entity_type} #{activity.entity_id}</span>
                </div>
                <p className="text-sm text-slate-300 truncate">{activity.description}</p>
                <span className="text-xs text-slate-500">by {activity.actor}</span>
              </div>
              <span className="text-xs text-slate-600 whitespace-nowrap">
                {formatRelativeTime(activity.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
