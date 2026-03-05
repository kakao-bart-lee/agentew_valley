import { useEffect, useMemo, useState } from 'react';
import type { ActivitiesResponse, ActivityEntry, ActivityEntityType } from '@agent-observatory/shared';
import { fetchJsonWithAuth, getApiBase } from '../../lib/api';
import { useAgentStore } from '../../stores/agentStore';
import { useMissionControlStore } from '../../stores/missionControlStore';
import { Button } from '../../components/ui/button';

const PAGE_SIZE = 25;

const ENTITY_OPTIONS: Array<{ label: string; value: '' | ActivityEntityType }> = [
  { label: 'All entities', value: '' },
  { label: 'Tasks', value: 'task' },
  { label: 'Agents', value: 'agent' },
  { label: 'Approvals', value: 'approval' },
  { label: 'Goals', value: 'goal' },
  { label: 'Sessions', value: 'session' },
];

const ENTITY_ICONS: Record<ActivityEntityType, string> = {
  task: 'T',
  agent: 'A',
  approval: 'G',
  goal: 'O',
  session: 'S',
};

function formatTimestamp(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleString();
}

export function ActivityTimelineView() {
  const [data, setData] = useState<ActivitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [entityType, setEntityType] = useState<ActivityEntityType | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const setView = useAgentStore((state) => state.setView);
  const setActiveTab = useMissionControlStore((state) => state.setActiveTab);
  const selectTask = useMissionControlStore((state) => state.selectTask);
  const selectApproval = useMissionControlStore((state) => state.selectApproval);
  const activityVersion = useMissionControlStore((state) => state.versions.activities);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (entityType) params.set('entity_type', entityType);
    if (dateFrom) params.set('from', `${dateFrom}T00:00:00Z`);
    if (dateTo) params.set('to', `${dateTo}T23:59:59Z`);

    const load = async () => {
      setLoading(true);
      try {
        const nextData = await fetchJsonWithAuth<ActivitiesResponse>(`${getApiBase()}/api/v2/activities?${params.toString()}`);
        if (!cancelled) {
          setData(nextData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData({ activities: [], total: 0, mc_db_connected: false });
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activityVersion, dateFrom, dateTo, entityType, page]);

  const totalPages = useMemo(() => {
    const total = data?.total ?? 0;
    return total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
  }, [data?.total]);

  const openEntity = (activity: ActivityEntry) => {
    if (activity.entity_type === 'task' && activity.entity_id) {
      selectTask(activity.entity_id);
      selectApproval(null);
      setActiveTab('tasks');
      setView('mission-control');
      return;
    }

    if (activity.entity_type === 'approval' && activity.entity_id) {
      selectApproval(activity.entity_id);
      selectTask(null);
      setActiveTab('approvals');
      setView('mission-control');
      return;
    }

    setActiveTab('activity');
    setView('mission-control');
  };

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-4 md:p-6">
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Activity Timeline</h2>
            <p className="text-sm text-slate-400">Governance and task mutations across the observatory.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>Entity</span>
              <select
                value={entityType}
                onChange={(event) => {
                  setPage(0);
                  setEntityType(event.target.value as ActivityEntityType | '');
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                {ENTITY_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setPage(0);
                  setDateFrom(event.target.value);
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              <span>To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setPage(0);
                  setDateTo(event.target.value);
                }}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="p-4 text-sm text-slate-400">Loading activity timeline...</div>
          ) : !data?.mc_db_connected ? (
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-400">
              Mission Control DB is not connected.
            </div>
          ) : (data.activities.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
              No activities matched the current filters.
            </div>
          ) : (
            data.activities.map((activity) => (
              <div key={activity.id} className="flex gap-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-slate-100">
                  {ENTITY_ICONS[activity.entity_type]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-100">{activity.type}</span>
                    <span className="text-xs text-slate-500">
                      {activity.actor ?? activity.actor_type} on {activity.entity_type}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-300">{activity.description ?? activity.type}</p>
                  {activity.entity_id && (
                    <button
                      type="button"
                      onClick={() => openEntity(activity)}
                      className="mt-2 text-xs font-medium text-cyan-300 transition-colors hover:text-cyan-200"
                    >
                      Open {activity.entity_type} {activity.entity_id}
                    </button>
                  )}
                </div>
                <div className="text-right text-xs text-slate-500">
                  {formatTimestamp(activity.created_at)}
                </div>
              </div>
            ))
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Page {page + 1} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setPage((current) => Math.max(current - 1, 0))} disabled={page === 0}>
              Previous
            </Button>
            <Button type="button" variant="outline" onClick={() => setPage((current) => current + 1)} disabled={page + 1 >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
