import { UAEPEvent } from '../../types/uaep';
import { Badge } from '../../components/ui/badge';
import { SOURCE_LABELS, SOURCE_COLORS } from '../../utils/colors';

const formatEventTime = (ts: string) => {
    try {
        const d = new Date(ts);
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
    } catch (e) {
        return '--:--:--';
    }
};

export function ActivityFeedItem({ event }: { event: UAEPEvent }) {
    const { type, source, agent_name, ts, data } = event;

    const timeStr = formatEventTime(ts);
    const sourceLabel = SOURCE_LABELS[source] || 'U';
    const sourceColor = SOURCE_COLORS[source] || '#9ca3af';

    const str = (val: unknown, fallback = '') => (val != null ? String(val) : fallback);

    const renderContent = () => {
        switch (type) {
            case 'tool.start':
                return (
                    <div className="flex flex-col">
                        <div><span className="text-slate-400">→</span> {str(data?.tool_name, 'unknown')} <span className="text-xs text-slate-500">({str(data?.tool_category, 'other')})</span></div>
                        {Boolean(data?.input_summary) && <div className="text-slate-400 text-xs mt-0.5 truncate max-w-sm">{str(data?.input_summary)}</div>}
                    </div>
                );
            case 'tool.end':
                return (
                    <div className="flex flex-col">
                        <div className="flex items-center gap-1">
                            {data?.success !== false ? <span className="text-emerald-500">✓</span> : <span className="text-red-500">✗</span>}
                            {str(data?.tool_name, 'Tool completed')}
                            {data?.duration_ms != null && <span className="text-xs text-slate-500 ml-1">{str(data.duration_ms)}ms</span>}
                        </div>
                        {Boolean(data?.output_summary) && <div className="text-slate-400 text-xs mt-0.5 truncate max-w-sm">{str(data?.output_summary)}</div>}
                    </div>
                );
            case 'tool.error': {
                const isInterrupt = Boolean(data?.is_interrupt);
                return (
                    <div className={isInterrupt ? 'text-amber-400' : 'text-red-400'}>
                        <span>{isInterrupt ? '⚡' : '✗'}</span>{' '}
                        {str(data?.tool_name, 'unknown')}
                        {isInterrupt
                            ? <span className="text-xs text-amber-500 ml-1">(interrupted)</span>
                            : <span>: {data?.error_message ? str(data.error_message) : 'Error occurred'}</span>
                        }
                    </div>
                );
            }
            case 'llm.end': {
                const modelId = str(event.model_id ?? data?.model_id);
                const textLen = typeof data?.text_length === 'number' ? data.text_length : null;
                return (
                    <div className="flex items-center gap-1.5 text-slate-400">
                        <span className="text-indigo-400">◆</span>
                        <span className="text-xs">LLM response</span>
                        {modelId && <span className="text-[10px] text-slate-500 bg-slate-700 px-1 rounded">{modelId}</span>}
                        {textLen !== null && <span className="text-xs text-slate-500 ml-auto">{textLen.toLocaleString()} chars</span>}
                    </div>
                );
            }
            case 'agent.status':
                return <div className="text-amber-400">⚡ Status: {str(data?.status)}</div>;
            case 'user.input':
                return <div className="text-blue-400">💬 User input</div>;
            case 'session.start':
                return <div className="text-emerald-400">▶ Session started</div>;
            case 'session.end':
                return <div className="text-slate-400">⏹ Session ended</div>;
            case 'subagent.spawn':
                return <div className="text-purple-400">🔀 Spawned: {str(data?.child_agent_name ?? data?.child_agent_id, 'sub-agent')}</div>;
            default:
                return <div className="text-slate-500 text-xs">Unknown event: {type}</div>;
        }
    };

    return (
        <div className="flex items-start gap-2 py-2 px-3 border-b border-slate-700/50 hover:bg-slate-700/20 group transition-colors text-sm">
            <span className="text-slate-500 text-xs min-w-[60px] font-mono leading-5">{timeStr}</span>

            <Badge
                variant="outline"
                className="text-white border-transparent text-[10px] px-1 h-5 min-w-[28px] flex justify-center mt-0.5"
                style={{ backgroundColor: sourceColor }}
            >
                {sourceLabel}
            </Badge>

            <span className="font-medium text-slate-300 min-w-[100px] truncate leading-6" title={agent_name}>
                {agent_name}
            </span>

            <div className="flex-1 overflow-hidden leading-6">
                {renderContent()}
            </div>
        </div>
    );
}
