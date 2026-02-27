import React, { useMemo } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { AgentCard } from './AgentCard';
import { AgentLiveState } from '../../types/agent';
import { sortAgents, SortMode } from '../../utils/sorting';
import { AgentCardFilters } from './AgentCardFilters';

export function AgentCardGrid() {
    const { agents, sourceFilter, statusFilter, teamFilter } = useAgentStore();

    const filteredAndSortedAgents = useMemo(() => {
        let list = Array.from(agents.values());

        if (sourceFilter.length > 0) {
            list = list.filter(a => sourceFilter.includes(a.source));
        }
        if (statusFilter.length > 0) {
            list = list.filter(a => statusFilter.includes(a.status));
        }
        if (teamFilter.length > 0) {
            list = list.filter(a => a.team_id && teamFilter.includes(a.team_id));
        }

        // Default sorting mode for now
        return sortAgents(list, 'status');
    }, [agents, sourceFilter, statusFilter, teamFilter]);

    if (agents.size === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500 h-64 border border-dashed border-slate-700 rounded-lg">
                <p>No active agents detected.</p>
                <p className="text-sm">Watching connected directories...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <AgentCardFilters />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pb-4 custom-scrollbar">
                {filteredAndSortedAgents.map(agent => (
                    <AgentCard key={agent.agent_id} agent={agent} />
                ))}
            </div>
        </div>
    );
}
