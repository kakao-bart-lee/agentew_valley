import { useEffect, useState } from 'react';
import type {
  DashboardSummaryResponse,
  AgentCostEntry,
  ModelCostEntry,
  BudgetAlertEntry,
} from '@agent-observatory/shared';
import { fetchJsonWithAuth, getApiBase } from '../../lib/api';
import { formatCurrency, formatLargeNumber } from '../../utils/formatters';

function formatProjectLabel(projectId: string): string {
  if (projectId.startsWith('/')) {
    return projectId.split('/').filter(Boolean).pop() ?? projectId;
  }
  return projectId;
}

function formatBudgetLabel(budgetCents: number, spentUsd: number): string {
  return `${formatCurrency(spentUsd)} / ${formatCurrency(budgetCents / 100)}`;
}

export function CostSummaryCard() {
  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSummary = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const nextSummary = await fetchJsonWithAuth<DashboardSummaryResponse>(
          `${getApiBase()}/api/v1/dashboard/summary`,
        );
        if (!cancelled) {
          setSummary(nextSummary);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard summary');
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
  }, []);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Cost Summary</h2>
          <p className="text-sm text-slate-400">
            Project, agent, and model spend with runtime budget alerts.
          </p>
        </div>
        {summary && (
          <span
            className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ${
              summary.pending_alerts === 0
                ? 'bg-slate-700 text-slate-300'
                : summary.alert_severity === 'critical'
                  ? 'bg-red-900/70 text-red-200'
                  : 'bg-amber-900/70 text-amber-200'
            }`}
          >
            {summary.pending_alerts} pending alert{summary.pending_alerts === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-500">Loading summary...</div>
      ) : error ? (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : !summary ? (
        <div className="py-10 text-center text-sm text-slate-500">No summary available.</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Total Cost</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">
                {formatCurrency(summary.cost_summary.total_cost_usd)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Total Tokens</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">
                {formatLargeNumber(summary.cost_summary.total_tokens)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Sessions</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">
                {summary.cost_summary.total_sessions}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="grid gap-4 md:grid-cols-3">
              <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Top Projects</h3>
                <div className="space-y-2 text-sm">
                  {summary.top_projects.length === 0 && <div className="text-slate-500">No project data</div>}
                  {summary.top_projects.slice(0, 3).map((project) => (
                    <div key={project.project_id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-slate-200" title={project.project_id}>
                        {formatProjectLabel(project.project_id)}
                      </span>
                      <span className="text-slate-400">{formatCurrency(project.total_cost_usd)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Top Agents</h3>
                <div className="space-y-2 text-sm">
                  {summary.top_agents.length === 0 && <div className="text-slate-500">No agent data</div>}
                  {summary.top_agents.slice(0, 3).map((agent: AgentCostEntry) => (
                    <div key={agent.agent_id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-slate-200">{agent.agent_name}</span>
                      <span className="text-slate-400">{formatCurrency(agent.total_cost_usd)}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Top Models</h3>
                <div className="space-y-2 text-sm">
                  {summary.top_models.length === 0 && <div className="text-slate-500">No model data</div>}
                  {summary.top_models.slice(0, 3).map((model: ModelCostEntry) => (
                    <div key={model.model_id} className="flex items-center justify-between gap-3">
                      <span className="truncate text-slate-200">{model.model_id}</span>
                      <span className="text-slate-400">{formatCurrency(model.total_cost_usd)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Alerts</h3>
              <div className="space-y-3 text-sm">
                {summary.budget_alerts.length === 0 ? (
                  <div className="text-slate-500">No active alerts</div>
                ) : (
                  <>
                    {summary.budget_alerts.slice(0, 3).map((alert: BudgetAlertEntry) => (
                      <div
                        key={alert.agent_id}
                        className={`rounded-lg border p-3 ${
                          alert.severity === 'critical'
                            ? 'border-red-800 bg-red-950/30 text-red-200'
                            : 'border-amber-800 bg-amber-950/30 text-amber-200'
                        }`}
                      >
                        <div className="font-medium">{alert.agent_name}</div>
                        <div className="mt-1 text-xs opacity-80">
                          {formatBudgetLabel(alert.budget_monthly_cents, alert.spent_monthly_usd)}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
