import { useMemo, useState } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { AgentCard } from './AgentCard';
import { sortAgents } from '../../utils/sorting';
import { AgentCardFilters } from './AgentCardFilters';
import { AgentLiveState } from '../../types/agent';

interface AgentCardGridProps {
    selectedAgentId?: string | null;
    onSelectAgent?: (id: string) => void;
}

export function AgentCardGrid({ selectedAgentId, onSelectAgent }: AgentCardGridProps) {
    const { agents, sourceFilter, statusFilter, teamFilter } = useAgentStore();
    const [groupByTeam, setGroupByTeam] = useState(false);
    const [sortMode, setSortMode] = useState<'status' | 'name' | 'activity' | 'cost'>('status');

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

        return sortAgents(list, sortMode);
    }, [agents, sourceFilter, statusFilter, teamFilter, sortMode]);

    if (agents.size === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500 h-64 border border-dashed border-slate-700 rounded-lg">
                <p>No active agents detected.</p>
                <p className="text-sm">Watching connected directories...</p>
            </div>
        );
    }

    const renderGrid = (agentList: AgentLiveState[]) => (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
            {agentList.map(agent => (
                <AgentCard
                    key={agent.agent_id}
                    agent={agent}
                    isSelected={agent.agent_id === selectedAgentId}
                    onClick={() => onSelectAgent?.(agent.agent_id)}
                />
            ))}
        </div>
    );

    let content;
    if (groupByTeam) {
        const teamMap = new Map<string, AgentLiveState[]>();
        filteredAndSortedAgents.forEach(agent => {
            const team = agent.team_id || 'Ungrouped';
            if (!teamMap.has(team)) teamMap.set(team, []);
            teamMap.get(team)!.push(agent);
        });

        content = Array.from(teamMap.entries()).sort().map(([teamName, teamAgents]) => (
            <div key={teamName} className="mb-6 bg-slate-900/40 p-3 rounded-lg border border-slate-800/80">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 px-1 border-b border-slate-800 pb-2">
                    Team: {teamName} <span className="text-slate-500 text-xs font-normal ml-2">({teamAgents.length} agents)</span>
                </h3>
                {renderGrid(teamAgents)}
            </div>
        ));
    } else {
        content = renderGrid(filteredAndSortedAgents);
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <AgentCardFilters />

                <div className="flex items-center gap-4 bg-slate-900/50 p-1.5 rounded-md border border-slate-700/50 shrink-0">
                    <div className="flex items-center space-x-2 px-2">
                        <input
                            type="checkbox"
                            id="group-team"
                            checked={groupByTeam}
                            onChange={(e) => setGroupByTeam(e.target.checked)}
                            className="bg-slate-800 border-slate-700 rounded cursor-pointer"
                        />
                        <label htmlFor="group-team" className="text-xs text-slate-300 cursor-pointer">Group by Team</label>
                    </div>
                    <div className="w-px h-4 bg-slate-700"></div>
                    <div className="flex items-center space-x-2 px-2">
                        <label className="text-xs text-slate-400">Sort by:</label>
                        <select
                            value={sortMode}
                            onChange={(e: any) => setSortMode(e.target.value)}
                            className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-slate-500 cursor-pointer"
                        >
                            <option value="status">Status</option>
                            <option value="name">Name</option>
                            <option value="activity">Activity</option>
                            <option value="cost">Cost</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="overflow-y-auto pb-4 custom-scrollbar">
                {filteredAndSortedAgents.length === 0 ? (
                    <div className="text-center p-8 text-slate-500">No agents match the current filters.</div>
                ) : content}
            </div>
        </div>
    );
}
