import { useMetricsStore } from '../../stores/metricsStore';
import { TokensChart } from './charts/TokensChart';
import { ToolDistribution } from './charts/ToolDistribution';
import { SourceDistribution } from './charts/SourceDistribution';
import { CostChart } from './charts/CostChart';
import { ActiveAgentsChart } from './charts/ActiveAgentsChart';

export function MetricsPanel() {
    const { snapshot } = useMetricsStore();

    if (!snapshot) {
        return <div className="flex h-full items-center justify-center text-slate-500">Waiting for metrics...</div>;
    }

    // Formatting timeseries for Recharts
    const timeseriesData = snapshot.timeseries.timestamps.map((ts, i) => {
        const timeLabel = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return {
            time: timeLabel,
            tokens: snapshot.timeseries.tokens_per_minute[i],
            cost: snapshot.timeseries.cost_per_minute[i] * 60, // Per hour estimate
            active: snapshot.timeseries.active_agents[i],
        };
    });

    const toolData = Object.entries(snapshot.tool_distribution)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => ({ name: key, value }))
        .sort((a, b) => b.value - a.value); // highest first

    const sourceData = Object.entries(snapshot.source_distribution)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => ({ name: key, value }));

    return (
        <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar pb-4">
            <TokensChart data={timeseriesData} />
            <CostChart data={timeseriesData} />
            <ActiveAgentsChart data={timeseriesData} />
            <ToolDistribution data={toolData} />
            <SourceDistribution data={sourceData} />
        </div>
    );
}
