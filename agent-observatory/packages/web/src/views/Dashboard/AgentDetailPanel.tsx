import { useAgentStore } from '../../stores/agentStore';
import { useSocket } from '../../hooks/useSocket';
import { useEffect, useState } from 'react';
import { UAEPEvent } from '../../types/uaep';
import { formatRelativeTime, formatLargeNumber, formatCurrency } from '../../utils/formatters';
import { X, Activity, TerminalSquare, AlertCircle, Server, Layers } from 'lucide-react';
import { STATUS_COLORS, SOURCE_COLORS } from '../../utils/colors';

interface AgentDetailPanelProps {
    agentId: string | null;
    onClose: () => void;
}

export function AgentDetailPanel({ agentId, onClose }: AgentDetailPanelProps) {
    const { agents } = useAgentStore();
    const { socket } = useSocket();
    const [events, setEvents] = useState<UAEPEvent[]>([]);
    const [loading, setLoading] = useState(false);

    const agent = agentId ? agents.get(agentId) : null;

    // Fetch existing history via REST API when agentId changes
    useEffect(() => {
        if (!agentId || import.meta.env?.VITE_MOCK !== 'false') return;

        setLoading(true);
        fetch(`http://localhost:3000/api/v1/agents/${agentId}/events?limit=100`)
            .then(res => res.json())
            .then(data => {
                if (data.events) {
                    setEvents(data.events);
                }
            })
            .catch(err => console.error('Failed to fetch agent events:', err))
            .finally(() => setLoading(false));

    }, [agentId]);

    // Subscribe to real-time events for this specific agent
    useEffect(() => {
        if (!agentId || !socket) return;

        // Mock sub for now until BE implements explicitly
        // socket.emit('subscribe', { agent_id: agentId });

        const handleEvent = (event: UAEPEvent) => {
            if (event.agent_id === agentId) {
                setEvents(prev => [event, ...prev].slice(0, 100)); // Keep last 100
            }
        };

        socket.on('event', handleEvent);

        return () => {
            socket.off('event', handleEvent);
            // socket.emit('unsubscribe', { agent_id: agentId });
        };
    }, [agentId, socket]);

    if (!agentId) return null;

    if (!agent) {
        return (
            <div className="fixed inset-y-0 right-0 w-96 bg-slate-900 border-l border-slate-700 p-6 shadow-2xl z-50 flex flex-col items-center justify-center">
                <p className="text-slate-400">Agent not found or disconnected.</p>
                <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-800 rounded text-sm hover:bg-slate-700">Close</button>
            </div>
        );
    }

    return (
        <div className="fixed inset-y-0 right-0 w-[450px] bg-slate-900 border-l border-slate-700 shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out">
            <div className="p-4 border-b border-slate-800 flex items-start justify-between bg-slate-800/50">
                <div className="flex flex-col gap-1 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 text-xs rounded bg-slate-700 text-slate-300 border border-slate-600" style={{ borderColor: SOURCE_COLORS[agent.source] }}>
                            {agent.source}
                        </span>
                        {agent.team_id && (
                            <span className="px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-400 border border-slate-700">
                                Team: {agent.team_id}
                            </span>
                        )}
                    </div>
                    <h2 className="text-xl font-bold text-slate-100 break-words">{agent.agent_name}</h2>
                    <p className="text-xs text-slate-500 font-mono">{agent.agent_id}</p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-md hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                >
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-6">

                {/* Status Card */}
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                    <div className="flex items-center gap-3 mb-4">
                        <Activity className="w-5 h-5 text-slate-400" />
                        <span className={`text-lg font-medium capitalize ${STATUS_COLORS[agent.status] || 'text-slate-400'}`}>
                            {agent.status}
                        </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-xs flex items-center gap-1.5"><TerminalSquare className="w-3.5 h-3.5" /> Tools Used</span>
                            <span className="text-slate-200 font-mono">{agent.total_tool_calls}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-xs flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> Errors</span>
                            <span className="text-slate-200 font-mono">{agent.total_errors}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-xs flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Total Tokens</span>
                            <span className="text-slate-200 font-mono">{formatLargeNumber(agent.total_tokens)}</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-slate-500 text-xs flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Est. Cost</span>
                            <span className="text-slate-200 font-mono text-emerald-400">{formatCurrency(agent.total_cost_usd)}</span>
                        </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-700/50 text-xs text-slate-500 flex justify-between">
                        <span>Started {formatRelativeTime(agent.session_start)}</span>
                        <span>Last seen {formatRelativeTime(agent.last_activity)}</span>
                    </div>
                </div>

                {/* Event History (Stub) */}
                <div className="flex flex-col flex-1 pb-6">
                    <h3 className="text-sm font-semibold text-slate-400 mb-3 pl-1 uppercase tracking-wider">Event Timeline</h3>
                    <div className="flex-1 bg-slate-900 rounded-lg border border-slate-800 p-3 min-h-[300px]">
                        {loading && events.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500"></div>
                                <span className="text-sm mt-2">Loading history...</span>
                            </div>
                        ) : events.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2">
                                <Activity className="w-8 h-8 opacity-20" />
                                <span className="text-sm">Listening for new events...</span>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2 relative border-l border-slate-700 ml-2 pl-4 py-2">
                                {events.map((ev, i) => (
                                    <div key={ev.metadata.event_id || i} className="text-xs p-2.5 rounded bg-slate-800/80 border border-slate-700 relative group">
                                        <div className="absolute w-2 h-2 rounded-full bg-slate-600 border-2 border-slate-900 -left-[21px] top-[14px] group-hover:bg-indigo-400"></div>
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-slate-300 font-medium">{ev.event_type}</span>
                                            <span className="text-slate-500">{new Date(ev.timestamp).toLocaleTimeString()}</span>
                                        </div>

                                        {/* Optional payload details preview */}
                                        {ev.event_type.startsWith('tool.') && ev.payload?.tool_name && (
                                            <div className="mt-1 text-[10px] bg-slate-900/50 p-1.5 rounded text-slate-400 font-mono truncate">
                                                {ev.payload.tool_name}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
