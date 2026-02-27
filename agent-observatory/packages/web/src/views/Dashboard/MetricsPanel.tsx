import { useState, useEffect } from 'react';
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
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { CacheEfficiencyChart } from './charts/CacheEfficiencyChart';
import type {
    CostByAgentResponse,
    CostByTeamResponse,
    CostByToolResponse,
    TokenAnalyticsResponse,
} from '@agent-observatory/shared';

const BASE_URL = import.meta.env?.VITE_WEBSOCKET_URL || 'http://localhost:3000';

type MetricsTab = 'live' | 'analytics';

interface AnalyticsData {
    byAgent: CostByAgentResponse | null;
    byTeam: CostByTeamResponse | null;
    byTool: CostByToolResponse | null;
    tokens: TokenAnalyticsResponse | null;
}

export function MetricsPanel() {
    const { snapshot } = useMetricsStore();
    const [tab, setTab] = useState<MetricsTab>('live');
    const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
    const [analyticsError, setAnalyticsError] = useState<string | null>(null);

    // analytics 탭 진입 시 4개 요청을 병렬로 실행 (최초 1회)
    useEffect(() => {
        if (tab !== 'analytics' || analytics !== null) return;

        setAnalyticsError(null);
        Promise.all([
            fetch(`${BASE_URL}/api/v1/analytics/cost/by-agent`).then(r => r.json()) as Promise<CostByAgentResponse>,
            fetch(`${BASE_URL}/api/v1/analytics/cost/by-team`).then(r => r.json()) as Promise<CostByTeamResponse>,
            fetch(`${BASE_URL}/api/v1/analytics/cost/by-tool`).then(r => r.json()) as Promise<CostByToolResponse>,
            fetch(`${BASE_URL}/api/v1/analytics/tokens`).then(r => r.json()) as Promise<TokenAnalyticsResponse>,
        ])
            .then(([byAgent, byTeam, byTool, tokens]) => {
                setAnalytics({ byAgent, byTeam, byTool, tokens });
            })
            .catch(err => {
                setAnalyticsError(err instanceof Error ? err.message : 'Failed to load analytics');
            });
    }, [tab, analytics]);

    if (!snapshot && tab === 'live') {
        return <div className="flex h-full items-center justify-center text-slate-500">Waiting for metrics...</div>;
    }

    // Formatting timeseries for Recharts (only needed for live tab)
    const timeseriesData = snapshot?.timeseries.timestamps.map((ts, i) => ({
        time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tokens: snapshot.timeseries.tokens_per_minute[i],
        cost: snapshot.timeseries.cost_per_minute[i] * 60,
        active: snapshot.timeseries.active_agents[i],
        cacheRate: snapshot.timeseries.cache_hit_rate?.[i] ?? 0,
        llmResponses: snapshot.timeseries.llm_responses_per_minute?.[i] ?? 0,
    })) ?? [];

    const modelDistribution = snapshot?.model_distribution ?? {};

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
                        <CacheEfficiencyChart data={timeseriesData} />
                        <ModelDistributionChart data={modelDistribution} />
                        <ToolDistribution data={toolData} />
                        <SourceDistribution data={sourceData} />
                    </>
                ) : analyticsError ? (
                    <div className="flex h-full items-center justify-center text-red-400 text-sm">
                        {analyticsError}
                    </div>
                ) : (
                    <>
                        <TokensAnalyticsChart data={analytics?.tokens ?? null} />
                        <CostByAgentChart data={analytics?.byAgent ?? null} />
                        <CostByTeamChart data={analytics?.byTeam ?? null} />
                        <CostByToolChart data={analytics?.byTool ?? null} />
                    </>
                )}
            </div>
        </div>
    );
}
