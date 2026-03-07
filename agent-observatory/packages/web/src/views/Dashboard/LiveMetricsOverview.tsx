import { useMetricsStore } from '../../stores/metricsStore';
import { buildMetricsTimeseries } from '../../utils/metrics';
import { TokensChart } from './charts/TokensChart';
import { CostChart } from './charts/CostChart';
import { ActiveAgentsChart } from './charts/ActiveAgentsChart';

export function LiveMetricsOverview() {
    const { snapshot } = useMetricsStore();
    const timeseriesData = buildMetricsTimeseries(snapshot);

    return (
        <section className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-pretty">Live Pulse</h2>
                    <p className="text-sm text-slate-400">
                        Keep the key graphs above the fold while you scan grouped agents below.
                    </p>
                </div>
                {snapshot && (
                    <div className="text-xs text-slate-500">
                        60-minute window · {snapshot.active_agents} active now
                    </div>
                )}
            </div>

            {!snapshot ? (
                <div className="flex min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/40 text-sm text-slate-500">
                    Waiting for metrics...
                </div>
            ) : (
                <div className="grid gap-4 xl:grid-cols-3">
                    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                        <TokensChart data={timeseriesData} />
                    </div>
                    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                        <CostChart data={timeseriesData} />
                    </div>
                    <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
                        <ActiveAgentsChart data={timeseriesData} />
                    </div>
                </div>
            )}
        </section>
    );
}
