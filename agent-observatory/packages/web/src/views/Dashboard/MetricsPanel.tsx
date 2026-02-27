import { useState } from 'react';
import { useMetricsStore } from '../../stores/metricsStore';
import { TokensChart } from './charts/TokensChart';
import { ToolDistribution } from './charts/ToolDistribution';
import { SourceDistribution } from './charts/SourceDistribution';
import { CostChart } from './charts/CostChart';
import { ActiveAgentsChart } from './charts/ActiveAgentsChart';
import { CostByAgentChart } from './charts/CostByAgentChart';
import { CostByTeamChart } from './charts/CostByTeamChart';
import { CostByToolChart } from './charts/CostByToolChart';
import { TokensAnalyticsChart } from './charts/TokensAnalyticsChart';

type MetricsTab = 'live' | 'analytics';

export function MetricsPanel() {
    const { snapshot } = useMetricsStore();
    const [tab, setTab] = useState<MetricsTab>('live');

    if (!snapshot && tab === 'live') {
        return <div className="flex h-full items-center justify-center text-slate-500">Waiting for metrics...</div>;
    }

    // Formatting timeseries for Recharts (only needed for live tab)
    const timeseriesData = snapshot?.timeseries.timestamps.map((ts, i) => ({
        time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tokens: snapshot.timeseries.tokens_per_minute[i],
        cost: snapshot.timeseries.cost_per_minute[i] * 60,
        active: snapshot.timeseries.active_agents[i],
    })) ?? [];

    const toolData = Object.entries(snapshot?.tool_distribution ?? {})
        .filter(([_, v]) => v > 0)
        .map(([key, value]) => ({ name: key, value }))
        .sort((a, b) => b.value - a.value);

    const sourceData = Object.entries(snapshot?.source_distribution ?? {})
        .filter(([_, v]) => v > 0)
        .map(([key, value]) => ({ name: key, value }));

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Tab switcher */}
            <div className="flex bg-slate-900/50 rounded-lg p-1 mb-3 shrink-0 border border-slate-700/50">
                <button
                    onClick={() => setTab('live')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'live' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Live Metrics
                </button>
                <button
                    onClick={() => setTab('analytics')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'analytics' ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    Analytics
                </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar pb-4 flex flex-col gap-6">
                {tab === 'live' ? (
                    <>
                        <TokensChart data={timeseriesData} />
                        <CostChart data={timeseriesData} />
                        <ActiveAgentsChart data={timeseriesData} />
                        <ToolDistribution data={toolData} />
                        <SourceDistribution data={sourceData} />
                    </>
                ) : (
                    <>
                        <TokensAnalyticsChart />
                        <CostByAgentChart />
                        <CostByTeamChart />
                        <CostByToolChart />
                    </>
                )}
            </div>
        </div>
    );
}
