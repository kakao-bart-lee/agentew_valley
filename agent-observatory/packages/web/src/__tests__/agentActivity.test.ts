import { describe, expect, it } from 'vitest';
import type { AgentLiveState } from '../types/agent';
import {
    LIVE_ACTIVITY_WINDOW_MS,
    RECENT_ACTIVITY_WINDOW_MS,
    isAgentLive,
    isAgentRecent,
    matchesAgentActivityScope,
    summarizeAgentActivity,
} from '../utils/agentActivity';

const makeAgent = (id: string, lastActivity: string): AgentLiveState => ({
    agent_id: id,
    agent_name: `Agent ${id}`,
    source: 'claude_code',
    status: 'idle',
    last_activity: lastActivity,
    session_id: `session-${id}`,
    session_start: lastActivity,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_cost_usd: 0,
    total_tool_calls: 0,
    total_errors: 0,
    health_status: 'normal',
    llm_response_count: 0,
    llm_total_text_length: 0,
    tool_distribution: {
        file_read: 0,
        file_write: 0,
        command: 0,
        search: 0,
        web: 0,
        planning: 0,
        thinking: 0,
        communication: 0,
        other: 0,
    },
    child_agent_ids: [],
});

describe('agentActivity', () => {
    it('classifies live vs recent vs loaded counts using freshness windows', () => {
        const now = Date.parse('2026-03-07T09:00:00.000Z');
        const agents = [
            makeAgent('live', new Date(now - (5 * 60 * 1000)).toISOString()),
            makeAgent('recent', new Date(now - (6 * 60 * 60 * 1000)).toISOString()),
            makeAgent('stale', new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString()),
        ];

        expect(summarizeAgentActivity(agents, now)).toEqual({
            liveNow: 1,
            recent: 2,
            loaded: 3,
            stale: 1,
        });
    });

    it('treats invalid timestamps as loaded only', () => {
        const now = Date.parse('2026-03-07T09:00:00.000Z');
        const invalid = makeAgent('broken', 'not-a-date');

        expect(isAgentLive(invalid, now)).toBe(false);
        expect(isAgentRecent(invalid, now)).toBe(false);
        expect(summarizeAgentActivity([invalid], now)).toEqual({
            liveNow: 0,
            recent: 0,
            loaded: 1,
            stale: 1,
        });
    });

    it('uses the exported freshness windows consistently', () => {
        const now = Date.parse('2026-03-07T09:00:00.000Z');
        const liveEdge = makeAgent('live-edge', new Date(now - LIVE_ACTIVITY_WINDOW_MS).toISOString());
        const recentEdge = makeAgent('recent-edge', new Date(now - RECENT_ACTIVITY_WINDOW_MS).toISOString());

        expect(isAgentLive(liveEdge, now)).toBe(true);
        expect(isAgentRecent(recentEdge, now)).toBe(true);
    });

    it('matches live, recent, and all scopes as expected', () => {
        const now = Date.parse('2026-03-07T09:00:00.000Z');
        const liveAgent = makeAgent('live', new Date(now - (5 * 60 * 1000)).toISOString());
        const recentAgent = makeAgent('recent', new Date(now - (6 * 60 * 60 * 1000)).toISOString());
        const staleAgent = makeAgent('stale', new Date(now - (3 * 24 * 60 * 60 * 1000)).toISOString());

        expect(matchesAgentActivityScope(liveAgent, 'live', now)).toBe(true);
        expect(matchesAgentActivityScope(recentAgent, 'live', now)).toBe(false);
        expect(matchesAgentActivityScope(recentAgent, 'recent', now)).toBe(true);
        expect(matchesAgentActivityScope(staleAgent, 'recent', now)).toBe(false);
        expect(matchesAgentActivityScope(staleAgent, 'all', now)).toBe(true);
    });
});
