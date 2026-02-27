import { AgentSourceType, ToolCategory } from "./agent";

export interface MetricsSnapshot {
    timestamp: string;

    active_agents: number;
    total_agents: number;
    total_tokens_per_minute: number;
    total_cost_per_hour: number;
    total_errors_last_hour: number;
    total_tool_calls_per_minute: number;

    tool_distribution: Record<ToolCategory, number>;
    source_distribution: Record<AgentSourceType, number>;

    timeseries: {
        timestamps: string[];
        tokens_per_minute: number[];
        cost_per_minute: number[];
        active_agents: number[];
        tool_calls_per_minute: number[];
        error_count: number[];
    };
}
