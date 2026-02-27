import { memo } from 'react';
import type { AgentLiveState } from '../../types/agent';
import { formatLargeNumber, formatRelativeTime } from '../../utils/formatters';
import { STATUS_COLORS, bgSTATUS_COLORS, SOURCE_COLORS, SOURCE_LABELS } from '../../utils/colors';
import { TerminalSquare, AlertCircle, Clock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

export const SubAgentCard = memo(function SubAgentCard({
    agent,
    isSelected,
    onClick,
}: {
    agent: AgentLiveState;
    isSelected?: boolean;
    onClick?: () => void;
}) {
    const {
        agent_name, status, source,
        total_tokens, total_tool_calls, total_errors,
        current_tool, last_activity,
    } = agent;

    return (
        <div
            onClick={onClick}
            className={`
                flex flex-col gap-1 px-2.5 py-2 rounded-lg border-l-2 border border-slate-700/60
                bg-slate-800/60 cursor-pointer transition-all duration-200 animate-in fade-in
                border-l-violet-500/50
                ${isSelected
                    ? 'border-indigo-500/70 ring-1 ring-indigo-500/50 bg-slate-800/90'
                    : 'hover:border-violet-500/40 hover:bg-slate-800/80'
                }
            `}
        >
            {/* Row 1: ↳ 소스 뱃지 · 이름 · 상태 점 */}
            <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-violet-400/70 text-[10px] shrink-0">↳</span>
                <span
                    className="text-[10px] font-medium text-white px-1 py-0 rounded shrink-0 leading-4"
                    style={{ backgroundColor: SOURCE_COLORS[source] || '#9ca3af' }}
                >
                    {SOURCE_LABELS[source] || '?'}
                </span>
                <span className="text-[11px] font-medium text-slate-200 truncate flex-1" title={agent_name}>
                    {agent_name}
                </span>
                <Tooltip>
                    <TooltipTrigger className="shrink-0 flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${bgSTATUS_COLORS[status] || 'bg-gray-400'}`} />
                        <span className={`text-[10px] font-medium capitalize ${STATUS_COLORS[status] || 'text-slate-400'}`}>
                            {status}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent><p className="capitalize">{status}</p></TooltipContent>
                </Tooltip>
            </div>

            {/* Row 2: 현재 도구 (acting 시에만) */}
            {status === 'acting' && current_tool && (
                <div className="flex items-center gap-1 text-[10px] text-slate-400 min-w-0">
                    <TerminalSquare className="w-2.5 h-2.5 shrink-0 text-slate-500" />
                    <span className="truncate">{current_tool}</span>
                </div>
            )}

            {/* Row 3: 통계 + 에러 */}
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className="font-mono">{formatLargeNumber(total_tokens)} tok</span>
                <span className="text-slate-700">·</span>
                <span className="font-mono">{total_tool_calls} tools</span>
                {total_errors > 0 && (
                    <>
                        <span className="text-slate-700">·</span>
                        <span className="flex items-center gap-0.5 text-red-400 font-medium">
                            <AlertCircle className="w-2.5 h-2.5" />{total_errors}
                        </span>
                    </>
                )}
                <span className="ml-auto flex items-center gap-1 text-slate-600">
                    <Clock className="w-2 h-2 shrink-0" />
                    <span>{formatRelativeTime(last_activity)}</span>
                </span>
            </div>
        </div>
    );
});
