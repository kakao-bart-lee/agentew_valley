import type { AgentLiveState } from './types/agent';
import { MetricsSnapshot } from './types/metrics';

// Simple mock data generator to run independently without a real backend

export function generateMockAgents(): AgentLiveState[] {
    return [
        {
            agent_id: 'cc-1',
            agent_name: 'Claude Code #1',
            source: 'claude_code',
            status: 'acting',
            current_tool: 'Bash',
            current_tool_category: 'command',
            status_detail: 'Running tests',
            last_activity: new Date().toISOString(),
            session_id: 'sess-1',
            session_start: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
            model_id: 'claude-sonnet-4-6',
            total_input_tokens: 9500,
            total_output_tokens: 3000,
            total_tokens: 12500,
            cache_creation_tokens: 2000,
            cache_read_tokens: 7000,
            total_cost_usd: 0.18,
            total_tool_calls: 42,
            total_errors: 0,
            llm_response_count: 12,
            llm_total_text_length: 24000,
            tool_distribution: {
                file_read: 10,
                file_write: 5,
                command: 20,
                search: 2,
                web: 3,
                planning: 1,
                thinking: 1,
                communication: 0,
                other: 0,
            },
            child_agent_ids: [],
        },
        {
            agent_id: 'oc-1',
            agent_name: 'OpenClaw Scraper',
            source: 'openclaw',
            status: 'thinking',
            team_id: 'team-alpha',
            last_activity: new Date().toISOString(),
            session_id: 'sess-2',
            session_start: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
            model_id: 'claude-haiku-4-5',
            total_input_tokens: 3500,
            total_output_tokens: 1000,
            total_tokens: 4500,
            cache_creation_tokens: 500,
            cache_read_tokens: 1200,
            total_cost_usd: 0.05,
            total_tool_calls: 12,
            total_errors: 1,
            llm_response_count: 5,
            llm_total_text_length: 5000,
            tool_distribution: {
                file_read: 2,
                file_write: 0,
                command: 0,
                search: 5,
                web: 5,
                planning: 0,
                thinking: 0,
                communication: 0,
                other: 0,
            },
            child_agent_ids: [],
        },
        {
            agent_id: 'sdk-1',
            agent_name: 'Swarm Leader',
            source: 'agent_sdk',
            status: 'idle',
            team_id: 'team-alpha',
            last_activity: new Date(Date.now() - 10000).toISOString(),
            session_id: 'sess-3',
            session_start: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
            model_id: 'claude-opus-4-6',
            total_input_tokens: 30000,
            total_output_tokens: 15000,
            total_tokens: 45000,
            cache_creation_tokens: 8000,
            cache_read_tokens: 22000,
            total_cost_usd: 1.25,
            total_tool_calls: 156,
            total_errors: 0,
            llm_response_count: 38,
            llm_total_text_length: 95000,
            tool_distribution: {
                file_read: 50,
                file_write: 20,
                command: 30,
                search: 10,
                web: 0,
                planning: 20,
                thinking: 10,
                communication: 16,
                other: 0,
            },
            child_agent_ids: ['oc-1'],
        }
    ];
}

export function generateMockMetrics(): MetricsSnapshot {
    const ts = new Date().toISOString();
    // generate dummy 60 points
    const timestamps = Array.from({ length: 60 }).map((_, i) => new Date(Date.now() - (59 - i) * 60000).toISOString());
    const tokenList = Array.from({ length: 60 }).map(() => Math.floor(Math.random() * 500) + 100);
    const costList = tokenList.map(t => (t / 1000) * 0.015);

    const inputList = tokenList.map(t => Math.round(t * 0.7));
    const outputList = tokenList.map(t => Math.round(t * 0.3));
    const cacheRateList = Array.from({ length: 60 }).map(() => Math.random() * 0.4 + 0.3);

    return {
        timestamp: ts,
        active_agents: 2,
        total_agents: 3,
        total_sessions: 3,
        total_tool_calls: 210,
        total_input_tokens: 43000,
        total_output_tokens: 19000,
        total_cost_usd: 1.48,
        tool_error_rate: 0.02,
        total_tokens_per_minute: 1250,
        total_cost_per_hour: 0.45,
        total_errors_last_hour: 1,
        total_tool_calls_per_minute: 15,
        tool_distribution: {
            file_read: 62,
            file_write: 25,
            command: 50,
            search: 17,
            web: 8,
            planning: 21,
            thinking: 11,
            communication: 16,
            other: 0,
        },
        source_distribution: {
            claude_code: 1,
            openclaw: 1,
            agent_sdk: 1,
            langchain: 0,
            crewai: 0,
            custom: 0,
            mission_control: 0,
        },
        model_distribution: {
            'claude-sonnet-4-6': { agent_count: 1, token_count: 12500 },
            'claude-haiku-4-5': { agent_count: 1, token_count: 4500 },
            'claude-opus-4-6': { agent_count: 1, token_count: 45000 },
        },
        cache_hit_rate: 0.71,
        cache_read_tokens: 30200,
        cache_creation_tokens: 10500,
        llm_responses_per_minute: 3,
        timeseries: {
            timestamps,
            input_tokens_per_minute: inputList,
            output_tokens_per_minute: outputList,
            tokens_per_minute: tokenList,
            cost_per_minute: costList,
            active_agents: Array.from({ length: 60 }).map(() => Math.floor(Math.random() * 2) + 1),
            tool_calls_per_minute: Array.from({ length: 60 }).map(() => Math.floor(Math.random() * 20)),
            error_count: Array.from({ length: 60 }).map(() => Math.random() > 0.9 ? 1 : 0),
            cache_hit_rate: cacheRateList,
            llm_responses_per_minute: Array.from({ length: 60 }).map(() => Math.floor(Math.random() * 5)),
        },
    };
}
