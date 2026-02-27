import { useAgentStore } from '../../stores/agentStore';
import { Button } from '../../components/ui/button';
import type { AgentSourceType, AgentStatus } from '../../types/agent';
import { useEffect, useState } from 'react';

export function AgentCardFilters() {
    const { sourceFilter, statusFilter, teamFilter, setFilters } = useAgentStore();
    const [availableTeams, setAvailableTeams] = useState<string[]>([]);

    // Fetch available teams from API
    useEffect(() => {
        if (import.meta.env?.VITE_MOCK === 'true') {
            // Mock behavior: just assume empty or basic list for now if in mock mode
            setAvailableTeams(['team-alpha']);
            return;
        }

        fetch('http://localhost:3000/api/v1/agents/by-team')
            .then(res => res.json())
            .then(data => {
                if (data.teams) {
                    setAvailableTeams(data.teams.map((t: any) => t.team_id).filter(Boolean));
                }
            })
            .catch(err => console.error('Failed to fetch teams:', err));
    }, []);

    const toggleSource = (source: AgentSourceType) => {
        if (sourceFilter.includes(source)) setFilters({ sourceFilter: sourceFilter.filter(s => s !== source) });
        else setFilters({ sourceFilter: [...sourceFilter, source] });
    };

    const toggleStatus = (status: AgentStatus) => {
        if (statusFilter.includes(status)) setFilters({ statusFilter: statusFilter.filter(s => s !== status) });
        else setFilters({ statusFilter: [...statusFilter, status] });
    };

    const toggleTeam = (teamId: string) => {
        if (teamFilter.includes(teamId)) setFilters({ teamFilter: teamFilter.filter(t => t !== teamId) });
        else setFilters({ teamFilter: [...teamFilter, teamId] });
    };

    return (
        <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-slate-400 mr-2">Filters:</span>

            <div className="flex bg-slate-900/50 p-1 rounded-md border border-slate-700/50 overflow-hidden">
                <Button
                    variant="ghost" size="sm"
                    className={`h-7 px-2 text-xs ${sourceFilter.length === 0 ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'text-slate-400'}`}
                    onClick={() => setFilters({ sourceFilter: [] })}>
                    All Sources
                </Button>
                <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${sourceFilter.includes('claude_code') ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`} onClick={() => toggleSource('claude_code')}>Claude Code</Button>
                <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${sourceFilter.includes('openclaw') ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`} onClick={() => toggleSource('openclaw')}>OpenClaw</Button>
            </div>

            <div className="flex bg-slate-900/50 p-1 rounded-md border border-slate-700/50 px-1 overflow-x-auto">
                <Button
                    variant="ghost" size="sm"
                    className={`h-7 px-2 text-xs whitespace-nowrap ${statusFilter.length === 0 ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'text-slate-400'}`}
                    onClick={() => setFilters({ statusFilter: [] })}>
                    All States
                </Button>
                <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${statusFilter.includes('acting') ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`} onClick={() => toggleStatus('acting')}>Active</Button>
                <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${statusFilter.includes('error') ? 'bg-slate-700 text-red-400' : 'text-slate-400'}`} onClick={() => toggleStatus('error')}>Error</Button>
            </div>

            {availableTeams.length > 0 && (
                <div className="flex flex-wrap bg-slate-900/50 p-1 rounded-md border border-slate-700/50">
                    <Button
                        variant="ghost" size="sm"
                        className={`h-7 px-2 text-xs ${teamFilter.length === 0 ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'text-slate-400'}`}
                        onClick={() => setFilters({ teamFilter: [] })}>
                        All Teams
                    </Button>
                    {availableTeams.map(teamId => (
                        <Button
                            key={teamId}
                            variant="ghost" size="sm"
                            className={`h-7 px-2 text-xs ${teamFilter.includes(teamId) ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`}
                            onClick={() => toggleTeam(teamId)}
                        >
                            {teamId}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
