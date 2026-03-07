import type { MetricsSnapshot } from '../types/metrics';

export interface MetricsTimeseriesPoint {
    time: string;
    tokens: number;
    cost: number;
    active: number;
    cacheRate: number;
    llmResponses: number;
}

export function buildMetricsTimeseries(snapshot: MetricsSnapshot | null): MetricsTimeseriesPoint[] {
    if (!snapshot) {
        return [];
    }

    return snapshot.timeseries.timestamps.map((ts, i) => ({
        time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tokens: snapshot.timeseries.tokens_per_minute[i],
        cost: snapshot.timeseries.cost_per_minute[i] * 60,
        active: snapshot.timeseries.active_agents[i],
        cacheRate: snapshot.timeseries.cache_hit_rate?.[i] ?? 0,
        llmResponses: snapshot.timeseries.llm_responses_per_minute?.[i] ?? 0,
    }));
}
