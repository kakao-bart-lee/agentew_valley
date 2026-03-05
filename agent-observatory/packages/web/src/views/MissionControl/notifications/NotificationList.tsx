import { useEffect, useState } from 'react';
import { fetchJsonWithAuth, getApiBase } from '../../../lib/api';

interface McNotification {
  id: number;
  recipient: string;
  type: string;
  title: string;
  message: string;
  source_type?: string;
  source_id?: number;
  read_at?: number;
  created_at: number;
}

interface NotificationsResponse {
  notifications: McNotification[];
  total: number;
  mc_db_connected?: boolean;
  code?: string;
  error?: string;
}

function formatRelativeTime(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationList() {
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);

  useEffect(() => {
    const url = `${getApiBase()}/api/v2/notifications?limit=50${unreadOnly ? '&unread_only=true' : ''}`;
    setLoading(true);
    fetchJsonWithAuth<NotificationsResponse>(url)
      .then((d: NotificationsResponse) => { setData(d); setLoading(false); })
      .catch(() => { setData({ notifications: [], total: 0, error: 'Network error', code: 'NETWORK_ERROR' }); setLoading(false); });
  }, [unreadOnly]);

  if (loading) return <div className="text-slate-400 text-sm p-4">Loading notifications...</div>;

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

  const notifications = data?.notifications ?? [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">
          총 {data?.total ?? 0}개 {unreadCount > 0 && <span className="text-amber-400">({unreadCount} 미읽음)</span>}
        </span>
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={`text-xs px-2 py-1 rounded transition-colors ${unreadOnly ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-700 text-slate-400 hover:text-slate-200'}`}
        >
          미읽음만
        </button>
      </div>

      {notifications.length === 0 && (
        <div className="text-slate-500 text-sm">{unreadOnly ? '미읽은 알림이 없습니다.' : '알림이 없습니다.'}</div>
      )}

      <div className="flex flex-col gap-1">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 py-2.5 px-3 rounded-lg border transition-colors ${
              n.read_at
                ? 'bg-slate-800/50 border-slate-700 opacity-70'
                : 'bg-slate-700 border-slate-600'
            }`}
          >
            <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.read_at ? 'bg-slate-600' : 'bg-indigo-400'}`} />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200 truncate">{n.title}</span>
                <span className="text-[10px] bg-slate-600 text-slate-400 px-1.5 py-0.5 rounded whitespace-nowrap">{n.type}</span>
              </div>
              <p className="text-xs text-slate-400 line-clamp-2">{n.message}</p>
              <span className="text-xs text-slate-500">To: {n.recipient}</span>
            </div>
            <span className="text-xs text-slate-600 whitespace-nowrap">
              {formatRelativeTime(n.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
