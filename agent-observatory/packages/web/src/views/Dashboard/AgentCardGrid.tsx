import React, { useMemo, useState, useEffect } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { AgentCard } from './AgentCard';
import { sortAgents } from '../../utils/sorting';
import { AgentCardFilters } from './AgentCardFilters';
import { AgentCardSkeleton } from '../../components/ui/skeleton';
import { AgentLiveState } from '../../types/agent';

interface AgentCardGridProps {
    selectedAgentId?: string | null;
    onSelectAgent?: (id: string) => void;
}

export function AgentCardGrid({ selectedAgentId, onSelectAgent }: AgentCardGridProps) {
    const { agents, sourceFilter, statusFilter, teamFilter, connected } = useAgentStore();
    const [groupByTeam, setGroupByTeam] = useState(false);
    // Show skeleton while waiting for initial connection + data
    const [hasReceivedData, setHasReceivedData] = useState(agents.size > 0);
    useEffect(() => {
        if (agents.size > 0) setHasReceivedData(true);
    }, [agents.size]);
    const [sortMode, setSortMode] = useState<'status' | 'name' | 'activity' | 'cost'>('status');

    // 팀 데이터를 마운트 시 한 번만 fetch — AgentCardFilters에도 동일한 데이터를 props로 전달
    const [serverTeams, setServerTeams] = useState<Array<{ team_id: string, agents: AgentLiveState[] }>>([]);

    useEffect(() => {
        if (import.meta.env?.VITE_MOCK === 'true') {
            return;
        }
        fetch('http://localhost:3000/api/v1/agents/by-team')
            .then(res => res.json())
            .then(data => {
                if (data.teams) {
                    setServerTeams(data.teams);
                }
            })
            .catch(err => console.error('Failed to fetch teams:', err));
    }, []);

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

    // Skeleton: connected but no data yet
    if (connected && !hasReceivedData) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <AgentCardSkeleton key={i} />)}
            </div>
        );
    }

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
        // Use server-provided groupings if available, otherwise fallback to local map
        let groupedTeams = serverTeams;

        if (serverTeams.length === 0 && import.meta.env?.VITE_MOCK === 'true') {
            // Mock fallback
            const teamMap = new Map<string, AgentLiveState[]>();
            filteredAndSortedAgents.forEach(agent => {
                const team = agent.team_id || 'Ungrouped';
                if (!teamMap.has(team)) teamMap.set(team, []);
                teamMap.get(team)!.push(agent);
            });
            groupedTeams = Array.from(teamMap.entries()).map(([team_id, team_agents]) => ({ team_id, agents: team_agents }));
        }

        content = [...groupedTeams].sort((a, b) => a.team_id.localeCompare(b.team_id)).map(({ team_id, agents: teamAgents }) => {
            // Apply current filters to the team's agents
            let localFiltered = teamAgents;
            if (sourceFilter.length > 0) localFiltered = localFiltered.filter(a => sourceFilter.includes(a.source));
            if (statusFilter.length > 0) localFiltered = localFiltered.filter(a => statusFilter.includes(a.status));

            // Sort them using our local sort utility
            const sortedLocal = sortAgents(localFiltered, sortMode);

            if (sortedLocal.length === 0) return null; // Don't show empty teams after filtering

            return (
                <div key={team_id} className="mb-6 bg-slate-900/40 p-3 rounded-lg border border-slate-800/80">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3 px-1 border-b border-slate-800 pb-2">
                        Team: {team_id} <span className="text-slate-500 text-xs font-normal ml-2">({sortedLocal.length} agents)</span>
                    </h3>
                    {renderGrid(sortedLocal)}
                </div>
            );
        });
    } else {
        content = renderGrid(filteredAndSortedAgents);
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <AgentCardFilters
                    availableTeams={
                        import.meta.env?.VITE_MOCK === 'true'
                            ? ['team-alpha']
                            : serverTeams.map(t => t.team_id).filter(Boolean)
                    }
                />

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
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortMode(e.target.value as typeof sortMode)}
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
