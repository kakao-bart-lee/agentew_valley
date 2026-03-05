import { useEffect, useMemo, useState } from 'react';
import type { DashboardSummaryResponse } from '@agent-observatory/shared';
import { useAgentStore } from '../../stores/agentStore';
import { useMetricsStore } from '../../stores/metricsStore';
import { useSocket } from '../../hooks/useSocket';
import { fetchJsonWithAuth, getApiBase } from '../../lib/api';
import { formatCurrency, formatLargeNumber } from '../../utils/formatters';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { getModelBadgeColor, getModelShortName } from '../../utils/colors';

export function StatusBar() {
    const { connected, reconnecting, activeView, setView: setStoreView } = useAgentStore();
    const { snapshot } = useMetricsStore();
    const { setView: setSocketView } = useSocket();
    const [summary, setSummary] = useState<DashboardSummaryResponse | null>(null);

    // selector로 파생값 구독 — 동일 값 반환 시 리렌더 건너뜀
    const activeAgents = useAgentStore(
        state => Array.from(state.agents.values()).filter(a => a.status !== 'idle').length,
    );
    const totalAgents = useAgentStore(state => state.agents.size);

    const tpm = snapshot?.total_tokens_per_minute || 0;
    const cph = snapshot?.total_cost_per_hour || 0;
    const errors = snapshot?.total_errors_last_hour || 0;

    // 모델 분포: 에이전트 수 기준 상위 3개만 표시
    const modelChips = useMemo(() => {
        if (!snapshot?.model_distribution) return [];
        return Object.entries(snapshot.model_distribution)
            .filter(([, v]) => v.agent_count > 0)
            .sort(([, a], [, b]) => b.agent_count - a.agent_count)
            .slice(0, 3);
    }, [snapshot?.model_distribution]);

    const cacheHitRate = snapshot?.cache_hit_rate ?? 0;
    const showCache = cacheHitRate > 0 || (snapshot?.cache_read_tokens ?? 0) > 0;
    const pendingAlerts = summary?.pending_alerts ?? 0;

    useEffect(() => {
        let cancelled = false;

        const loadSummary = async () => {
            try {
                const nextSummary = await fetchJsonWithAuth<DashboardSummaryResponse>(
                    `${getApiBase()}/api/v1/dashboard/summary`,
                );
                if (!cancelled) {
                    setSummary(nextSummary);
                }
            } catch {
                if (!cancelled) {
                    setSummary(null);
                }
            }
        };

        void loadSummary();
        const intervalId = window.setInterval(() => {
            void loadSummary();
        }, 30_000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, []);

    return (
        <Card className="flex flex-row items-center justify-between p-3 mx-4 mt-4 bg-slate-800 border-slate-700 text-slate-50">
            <div className="flex gap-6 items-center flex-wrap">
                {/* View Switcher */}
                <div className="flex bg-slate-900 rounded-lg p-1 mr-2">
                    <button
                        onClick={() => {
                            setStoreView('dashboard');
                            setSocketView('dashboard');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'dashboard' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Dashboard
                    </button>
                    <button
                        onClick={() => {
                            setStoreView('pixel');
                            setSocketView('pixel');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'pixel' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Pixel
                    </button>
                    <button
                        onClick={() => {
                            setStoreView('sessions');
                            setSocketView('dashboard');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'sessions' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Sessions
                    </button>
                    <button
                        onClick={() => {
                            setStoreView('mission-control');
                            setSocketView('dashboard');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'mission-control' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Mission Control
                    </button>
                </div>

                {/* Connection Status */}
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-500' : reconnecting ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                        }`} />
                    <span className="text-sm font-medium">
                        {connected ? 'Connected' : reconnecting ? 'Reconnecting...' : 'Disconnected'}
                    </span>
                </div>

                {/* Global Metrics */}
                <div className="flex gap-4 text-sm items-center divide-x divide-slate-600">
                    <div className="pl-4 first:pl-0 flex items-center gap-2">
                        <span className="text-slate-400">Active:</span>
                        <span className="font-semibold">{activeAgents} / {totalAgents}</span>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Tokens/min:</span>
                        <span className="font-semibold">{formatLargeNumber(tpm)}</span>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Cost/hr:</span>
                        <span className="font-semibold">{formatCurrency(cph)}</span>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Errors (1h):</span>
                        <Badge variant={errors > 0 ? "destructive" : "secondary"} className={errors === 0 ? "bg-slate-700 hover:bg-slate-600" : ""}>
                            {errors}
                        </Badge>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Alerts:</span>
                        <Badge
                            variant={summary?.alert_severity === 'critical' ? "destructive" : "secondary"}
                            className={
                                pendingAlerts === 0
                                    ? "bg-slate-700 hover:bg-slate-600"
                                    : summary?.alert_severity === 'warning'
                                        ? "bg-amber-600/80 text-amber-50 hover:bg-amber-600"
                                        : ""
                            }
                        >
                            {pendingAlerts}
                        </Badge>
                    </div>

                    {showCache && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="pl-4 flex items-center gap-2 cursor-default">
                                    <span className="text-slate-400">Cache:</span>
                                    <span className={`font-semibold ${cacheHitRate >= 0.5 ? 'text-emerald-400' : 'text-slate-200'}`}>
                                        {Math.round(cacheHitRate * 100)}%
                                    </span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Cache hit rate: {Math.round(cacheHitRate * 100)}% of input tokens read from prompt cache</p>
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {modelChips.length > 0 && (
                        <div className="pl-4 flex items-center gap-1.5">
                            <span className="text-slate-400 text-sm mr-1">Models:</span>
                            {modelChips.map(([modelId, dist]) => (
                                <Tooltip key={modelId}>
                                    <TooltipTrigger asChild>
                                        <span
                                            className="text-white text-[10px] px-1.5 py-0.5 rounded font-medium cursor-default"
                                            style={{ backgroundColor: getModelBadgeColor(modelId) }}
                                        >
                                            {getModelShortName(modelId)}
                                            {dist.agent_count > 1 && <span className="ml-1 opacity-80">×{dist.agent_count}</span>}
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{modelId}: {dist.agent_count} agent{dist.agent_count > 1 ? 's' : ''}, {dist.token_count.toLocaleString()} tokens</p>
                                    </TooltipContent>
                                </Tooltip>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Card>
    );
}
