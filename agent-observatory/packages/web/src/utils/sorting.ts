import { AgentLiveState, AgentStatus } from '../types/agent';

// Priority: error > waiting (input/permission) > acting > thinking > idle
const STATUS_PRIORITY: Record<AgentStatus, number> = {
    error: 0,
    waiting_input: 1,
    waiting_permission: 1,
    acting: 2,
    thinking: 3,
    idle: 4,
};

export type SortMode = 'status' | 'name' | 'activity' | 'cost';

export function sortAgents(agents: AgentLiveState[], mode: SortMode = 'status'): AgentLiveState[] {
    return [...agents].sort((a, b) => {
        switch (mode) {
            case 'status': {
                const pA = STATUS_PRIORITY[a.status];
                const pB = STATUS_PRIORITY[b.status];
                if (pA !== pB) return pA - pB;
                // fallback to last_activity (descending)
                return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();
            }

            case 'activity':
                return new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime();

            case 'cost':
                return b.total_cost_usd - a.total_cost_usd;

            case 'name':
            default:
                return a.agent_name.localeCompare(b.agent_name);
        }
    });
}
