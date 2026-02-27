import type { AgentLiveState } from '../../types/agent';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { formatCurrency, formatLargeNumber, formatRelativeTime } from '../../utils/formatters';
import { STATUS_COLORS, bgSTATUS_COLORS, SOURCE_COLORS, SOURCE_LABELS } from '../../utils/colors';
import { Activity, Clock, TerminalSquare, AlertCircle } from 'lucide-react';

export function AgentCard({ agent }: { agent: AgentLiveState }) {
    const {
        agent_name, status, source, total_tokens, total_cost_usd,
        total_tool_calls, total_errors, current_tool, current_tool_category,
        last_activity, session_start
    } = agent;

    return (
        <Card className={`relative bg-slate-800 border-slate-700 hover:border-slate-500 transition-colors cursor-pointer group`}>
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2">
                    <Badge
                        variant="outline"
                        className="text-white border-transparent text-xs px-1.5"
                        style={{ backgroundColor: SOURCE_COLORS[source] || '#9ca3af' }}
                    >
                        {SOURCE_LABELS[source] || 'Custom'}
                    </Badge>
                    <CardTitle className="text-base font-medium truncate max-w-[160px]" title={agent_name}>
                        {agent_name}
                    </CardTitle>
                </div>

                {/* Status Indicator */}
                <Tooltip>
                    <TooltipTrigger>
                        <div className={`w-3 h-3 rounded-full ${bgSTATUS_COLORS[status] || 'bg-gray-400'}`} />
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="capitalize">{status}</p>
                    </TooltipContent>
                </Tooltip>
            </CardHeader>

            <CardContent className="p-4 pt-2">

                <div className="flex flex-col gap-1.5 mb-3">
                    <div className="flex items-center gap-2 text-sm">
                        <Activity className="w-4 h-4 text-slate-400" />
                        <span className={`capitalize font-medium ${STATUS_COLORS[status] || 'text-slate-400'}`}>
                            {status}
                        </span>
                    </div>

                    {(status === 'acting' && current_tool) && (
                        <div className="flex items-center gap-2 text-sm text-slate-300">
                            <TerminalSquare className="w-4 h-4 text-slate-400" />
                            <span className="truncate">{current_tool} <span className="text-slate-500 text-xs">({current_tool_category})</span></span>
                        </div>
                    )}

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 mt-2">
                        <div><span className="text-slate-500">Tokens:</span> <span className="font-mono text-slate-300">{formatLargeNumber(total_tokens)}</span></div>
                        <div><span className="text-slate-500">Cost:</span> <span className="font-mono text-slate-300">{formatCurrency(total_cost_usd)}</span></div>
                        <div><span className="text-slate-500">Tools:</span> <span className="font-mono text-slate-300">{total_tool_calls}</span></div>
                        {total_errors > 0 && (
                            <div className="flex items-center gap-1 text-red-400 font-medium">
                                <AlertCircle className="w-3 h-3" /> {total_errors}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-700/50 pt-3">
                    <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Started {formatRelativeTime(session_start)}</span>
                    </div>
                    <span>Last seen: {formatRelativeTime(last_activity)}</span>
                </div>
            </CardContent>
        </Card>
    );
}
