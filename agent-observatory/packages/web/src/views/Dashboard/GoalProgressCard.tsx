import { useEffect, useState } from 'react';
import type { DashboardSummaryResponse } from '@agent-observatory/shared';
import { fetchJsonWithAuth, getApiBase } from '../../lib/api';
import { useMissionControlStore } from '../../stores/missionControlStore';

export function GoalProgressCard() {
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const summaryVersion = useMissionControlStore((state) => state.versions.summary);

  useEffect(() => {
    let cancelled = false;

    const loadSummary = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const response = await fetchJsonWithAuth<DashboardSummaryResponse>(`${getApiBase()}/api/v1/dashboard/summary`);
        if (!cancelled) {
          setSummary(response);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
          setLoading(false);
        }
      }
    };

    void loadSummary(true);
    const intervalId = window.setInterval(() => {
      void loadSummary(false);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [summaryVersion]);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-100">Goal Progress</h2>
        <p className="text-sm text-slate-400">Goal to project to task completion rollup.</p>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading goal progress...</div>
      ) : !summary || summary.goal_progress.length === 0 ? (
        <div className="text-sm text-slate-500">No synced goals yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {summary.goal_progress.map((goal) => (
            <div key={goal.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-100">{goal.title}</div>
                  <div className="text-xs text-slate-500">
                    {goal.completed_tasks}/{goal.total_tasks} complete
                    {goal.projects.length > 0 ? ` · ${goal.projects.join(', ')}` : ''}
                  </div>
                </div>
                <div className="text-xs text-slate-400">{Math.round(goal.completion_ratio * 100)}%</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-400"
                  style={{ width: `${Math.round(goal.completion_ratio * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
