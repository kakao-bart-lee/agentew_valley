import { useAgentStore } from '../../stores/agentStore';
import { UAEPEventType } from '../../types/uaep';
import { Button } from '../../components/ui/button';

interface ActivityFeedFiltersProps {
    agentFilter: string | null;
    setAgentFilter: (id: string | null) => void;
    typeFilters: UAEPEventType[];
    setTypeFilters: (types: UAEPEventType[]) => void;
}

const COMMON_EVENT_TYPES: { label: string; value: UAEPEventType }[] = [
    { label: 'Tool Start', value: 'tool.start' },
    { label: 'Tool End', value: 'tool.end' },
    { label: 'Tool Error', value: 'tool.error' },
    { label: 'Agent Status', value: 'agent.status' },
    { label: 'User Input', value: 'user.input' }
];

export function ActivityFeedFilters({
    agentFilter,
    setAgentFilter,
    typeFilters,
    setTypeFilters
}: ActivityFeedFiltersProps) {
    const agents = useAgentStore((state) => state.agents);
    const agentList = Array.from(agents.values());

    const toggleType = (type: UAEPEventType) => {
        if (typeFilters.includes(type)) {
            setTypeFilters(typeFilters.filter(t => t !== type));
        } else {
            setTypeFilters([...typeFilters, type]);
        }
    };

    return (
        <div className="flex flex-col gap-4 text-xs">
            <div>
                <h4 className="font-semibold text-slate-300 mb-2">Filter by Agent</h4>
                <div className="flex flex-wrap gap-1">
                    <Button
                        variant={agentFilter === null ? "default" : "outline"}
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => setAgentFilter(null)}
                    >
                        All
                    </Button>
                    {agentList.map(agent => (
                        <Button
                            key={agent.agent_id}
                            variant={agentFilter === agent.agent_id ? "default" : "outline"}
                            size="sm"
                            className="h-6 text-[10px] px-2 truncate max-w-[120px]"
                            onClick={() => setAgentFilter(agent.agent_id)}
                            title={agent.agent_name}
                        >
                            {agent.agent_name}
                        </Button>
                    ))}
                </div>
            </div>

            <div>
                <h4 className="font-semibold text-slate-300 mb-2">Filter by Event Type</h4>
                <div className="flex flex-wrap gap-1">
                    {COMMON_EVENT_TYPES.map(type => (
                        <Button
                            key={type.value}
                            variant={typeFilters.includes(type.value) ? "default" : "outline"}
                            size="sm"
                            className="h-6 text-[10px] px-2"
                            onClick={() => toggleType(type.value)}
                        >
                            {type.label}
                        </Button>
                    ))}
                    {typeFilters.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px] px-2 text-slate-400"
                            onClick={() => setTypeFilters([])}
                        >
                            Clear Type Filters
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
