import { useAgentStore } from '../../stores/agentStore';
import type { AgentLiveState } from '../../types/agent';

export function RelationshipGraph() {
    const { agents } = useAgentStore();
    const agentList = Array.from(agents.values());

    const tops = agentList.filter(a => !a.parent_agent_id);

    if (agentList.length === 0) {
        return <div className="text-slate-500 pt-8 text-center text-sm">No active agents</div>;
    }

    // Recursive render for simple trees
    const renderTree = (agent: AgentLiveState) => {
        const children = agentList.filter(a => a.parent_agent_id === agent.agent_id);

        return (
            <div key={agent.agent_id} className="flex flex-col items-center mb-4">
                {/* Node */}
                <div className={`px-3 py-1.5 border rounded-md text-sm font-medium whitespace-nowrap z-10 relative
          ${agent.status === 'error' ? 'border-red-500/50 bg-red-900/20 text-red-400' :
                        agent.status === 'idle' ? 'border-slate-700 bg-slate-800 text-slate-400' :
                            'border-emerald-500/50 bg-emerald-900/20 text-emerald-400'}`}
                >
                    {agent.agent_name}
                </div>

                {/* Edges & Children - children wrapper must be positioned relative to draw horizontal lines correctly without overlapping team boundaries */}
                {children.length > 0 && (
                    <div className="flex flex-col items-center mt-2 relative z-0">
                        <div className="w-px h-6 bg-slate-600 -mt-2"></div>
                        <div className="flex gap-4 border-t border-slate-600 pt-2 px-2">
                            {children.map(child => renderTree(child))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Group top-level agents by team
    const teamMap = new Map<string, AgentLiveState[]>();
    tops.forEach(agent => {
        const team = agent.team_id || 'Ungrouped';
        if (!teamMap.has(team)) teamMap.set(team, []);
        teamMap.get(team)!.push(agent);
    });

    const teams = Array.from(teamMap.entries()).sort();

    return (
        <div className="h-full w-full overflow-auto custom-scrollbar flex p-4 gap-8 items-start">
            {teams.map(([teamName, teamAgents]) => (
                <div
                    key={teamName}
                    className="flex flex-col relative border border-dashed border-slate-700/80 rounded-xl p-6 bg-slate-900/30 min-w-[200px]"
                >
                    <div className="absolute -top-3 left-4 bg-slate-950 px-2 text-xs font-semibold text-slate-400 border border-dashed border-slate-700/80 rounded-full">
                        Team: {teamName}
                    </div>
                    <div className="flex justify-around items-start gap-8 pt-2">
                        {teamAgents.map(topAgent => renderTree(topAgent))}
                    </div>
                </div>
            ))}
        </div>
    );
}
