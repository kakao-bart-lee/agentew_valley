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
                <div className={`px-3 py-1.5 border rounded-md text-sm font-medium whitespace-nowrap z-10 
          ${agent.status === 'error' ? 'border-red-500/50 bg-red-900/20 text-red-400' :
                        agent.status === 'idle' ? 'border-slate-700 bg-slate-800 text-slate-400' :
                            'border-emerald-500/50 bg-emerald-900/20 text-emerald-400'}`}
                >
                    {agent.agent_name}
                </div>

                {/* Edges & Children */}
                {children.length > 0 && (
                    <div className="flex flex-col items-center mt-2">
                        <div className="w-px h-6 bg-slate-600 -mt-2"></div>
                        <div className="flex gap-4 border-t border-slate-600 pt-2 px-2 relative">
                            {children.map(child => renderTree(child))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full w-full overflow-auto custom-scrollbar flex p-4 justify-around items-start">
            {tops.map(topAgent => renderTree(topAgent))}
        </div>
    );
}
