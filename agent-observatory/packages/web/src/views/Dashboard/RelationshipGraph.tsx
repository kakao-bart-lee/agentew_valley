import { useAgentStore } from '../../stores/agentStore';
import { useEffect, useState } from 'react';
import type { AgentLiveState, AgentHierarchyNode } from '../../types/agent';
import { getApiBase } from '../../lib/api';

interface RelationshipGraphProps {
    selectedAgentId?: string | null;
    onSelectAgent?: (id: string) => void;
}

const API_BASE = getApiBase();

export function RelationshipGraph({ selectedAgentId, onSelectAgent }: RelationshipGraphProps) {
    const { agents } = useAgentStore();
    // agents.size(primitive)를 별도 selector로 구독 — 에이전트 수 변경 시에만 hierarchy 재fetch
    const agentCount = useAgentStore(state => state.agents.size);
    const [hierarchyTeams, setHierarchyTeams] = useState<AgentHierarchyNode[]>([]);

    useEffect(() => {
        // Reset on every change — prevents stale hierarchy after agent removal
        setHierarchyTeams([]);
        if (import.meta.env?.VITE_MOCK !== 'true' && agentCount > 0) {
            fetch(`${API_BASE}/api/v1/agents/hierarchy`)
                .then(res => res.json())
                .then(data => {
                    if (data.hierarchy) {
                        setHierarchyTeams(data.hierarchy);
                    }
                })
                .catch(err => console.error("Failed to load hierarchy:", err));
        }
    }, [agentCount]); // 에이전트 수 변경 시에만 재fetch (상태 업데이트는 무시)

    // Local fallback for Mock mode
    const tops = Array.from(agents.values()).filter(a => !a.parent_agent_id);

    if (agents.size === 0) {
        return <div className="text-slate-500 pt-8 text-center text-sm">No active agents</div>;
    }

    // Recursive render for simple trees
    const renderNode = (node: AgentHierarchyNode | AgentLiveState, mockChildren: AgentLiveState[] = []) => {
        const isMock = !('children' in node);
        const agent = isMock ? (node as AgentLiveState) : (node as AgentHierarchyNode).agent;

        // Merge latest live state from store if available to animate status changes, fallback to passed node agent
        const liveAgent = agents.get(agent.agent_id) || agent;
        const children = isMock ? mockChildren : (node as AgentHierarchyNode).children;

        return (
            <div key={liveAgent.agent_id} className="flex flex-col items-center mb-4">
                {/* Node */}
                <div
                    onClick={() => onSelectAgent?.(agent.agent_id)}
                    className={`px-3 py-1.5 border rounded-md text-sm font-medium whitespace-nowrap z-10 relative cursor-pointer transition-all
          ${liveAgent.agent_id === selectedAgentId ? 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20 ' : ''}
          ${liveAgent.status === 'error' ? 'border-red-500/50 bg-red-900/20 text-red-400' :
                            liveAgent.status === 'idle' ? 'border-slate-700 bg-slate-800 text-slate-400' :
                                'border-emerald-500/50 bg-emerald-900/20 text-emerald-400'}`}
                >
                    {liveAgent.agent_name}
                </div>

                {/* Edges & Children */}
                {children.length > 0 && (
                    <div className="flex flex-col items-center mt-2 relative z-0">
                        <div className="w-px h-6 bg-slate-600 -mt-2"></div>
                        <div className="flex gap-4 border-t border-slate-600 pt-2 px-2">
                            {children.map((child: any) => renderNode(child as AgentHierarchyNode, isMock ? Array.from(agents.values()).filter(a => a.parent_agent_id === (child as AgentLiveState).agent_id) : []))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Group top-level agents by team
    const teamMap = new Map<string, Array<AgentHierarchyNode | AgentLiveState>>();

    if (hierarchyTeams.length > 0) {
        hierarchyTeams.forEach(node => {
            const team = node.agent.team_id || 'Ungrouped';
            if (!teamMap.has(team)) teamMap.set(team, []);
            teamMap.get(team)!.push(node);
        });
    } else {
        // Fallback mock rendering using local agents map
        tops.forEach(agent => {
            const team = agent.team_id || 'Ungrouped';
            if (!teamMap.has(team)) teamMap.set(team, []);
            teamMap.get(team)!.push(agent);
        });
    }

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
                        {teamAgents.map(topAgent => renderNode(topAgent, !('children' in topAgent) ? Array.from(agents.values()).filter(a => a.parent_agent_id === (topAgent as AgentLiveState).agent_id) : []))}
                    </div>
                </div>
            ))}
        </div>
    );
}
