import type { AgentLiveState } from '../types/agent';

export const LIVE_ACTIVITY_WINDOW_MS = 15 * 60 * 1000;
export const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AgentActivitySummary {
    liveNow: number;
    recent: number;
    loaded: number;
    stale: number;
}

function getLastActivityAgeMs(agent: AgentLiveState, now: number): number {
    const lastActivityMs = Date.parse(agent.last_activity);
    if (!Number.isFinite(lastActivityMs)) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.max(0, now - lastActivityMs);
}

export function isAgentLive(
    agent: AgentLiveState,
    now: number = Date.now(),
    liveWindowMs: number = LIVE_ACTIVITY_WINDOW_MS,
): boolean {
    return getLastActivityAgeMs(agent, now) <= liveWindowMs;
}

export function isAgentRecent(
    agent: AgentLiveState,
    now: number = Date.now(),
    recentWindowMs: number = RECENT_ACTIVITY_WINDOW_MS,
): boolean {
    return getLastActivityAgeMs(agent, now) <= recentWindowMs;
}

export function summarizeAgentActivity(
    agents: Iterable<AgentLiveState>,
    now: number = Date.now(),
): AgentActivitySummary {
    let liveNow = 0;
    let recent = 0;
    let loaded = 0;

    for (const agent of agents) {
        loaded += 1;

        if (isAgentLive(agent, now)) {
            liveNow += 1;
        }

        if (isAgentRecent(agent, now)) {
            recent += 1;
        }
    }

    return {
        liveNow,
        recent,
        loaded,
        stale: Math.max(loaded - recent, 0),
    };
}
