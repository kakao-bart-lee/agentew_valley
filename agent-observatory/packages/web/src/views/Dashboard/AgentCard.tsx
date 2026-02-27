import { memo, useMemo } from 'react';
import type { AgentLiveState } from '../../types/agent';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { formatLargeNumber, formatRelativeTime } from '../../utils/formatters';
import { STATUS_COLORS, bgSTATUS_COLORS, SOURCE_COLORS, SOURCE_LABELS, CATEGORY_COLORS, getModelBadgeColor, getModelShortName } from '../../utils/colors';
import { Activity, Clock, TerminalSquare, AlertCircle } from 'lucide-react';

export const AgentCard = memo(function AgentCard({ agent, isSelected, onClick }: { agent: AgentLiveState, isSelected?: boolean, onClick?: () => void }) {
    const {
        agent_name, status, source, total_tokens, total_tool_calls, total_errors,
        current_tool, last_activity, session_start, model_id,
        cache_read_tokens, total_input_tokens,
    } = agent;

    const cacheRate = useMemo(() => {
        const total = (total_input_tokens ?? 0) + (cache_read_tokens ?? 0);
        if (total === 0) return null;
        return Math.round((cache_read_tokens ?? 0) / total * 100);
    }, [total_input_tokens, cache_read_tokens]);

    const sortedToolEntries = useMemo(() => {
        const entries = Object.entries(agent.tool_distribution ?? {}).filter(([, v]) => v > 0);
        entries.sort(([, a], [, b]) => b - a);
        return entries;
    }, [agent.tool_distribution]);

    const toolTotal = useMemo(
        () => sortedToolEntries.reduce((sum, [, v]) => sum + v, 0),
        [sortedToolEntries],
    );

    return (
        <Card
            className={`relative bg-slate-800 transition-all duration-300 cursor-pointer animate-in fade-in slide-in-from-bottom-2 ${isSelected
                ? 'border-indigo-500 ring-1 ring-indigo-500 bg-slate-800/80 shadow-lg shadow-indigo-500/10'
                : 'border-slate-700 hover:border-slate-500'
                }`}
            onClick={onClick}
        >
            <CardHeader className="p-2.5 pb-1 flex flex-row items-center justify-between space-y-0 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Badge
                        variant="outline"
                        className="text-white border-transparent text-[10px] px-1.5 py-0 h-4 shrink-0"
                        style={{ backgroundColor: SOURCE_COLORS[source] || '#9ca3af' }}
                    >
                        {SOURCE_LABELS[source] || 'Custom'}
                    </Badge>
                    {model_id && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge
                                    variant="outline"
                                    className="text-white border-transparent text-[10px] px-1.5 py-0 h-4 shrink-0"
                                    style={{ backgroundColor: getModelBadgeColor(model_id) }}
                                >
                                    {getModelShortName(model_id)}
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent><p>{model_id}</p></TooltipContent>
                        </Tooltip>
                    )}
                    <CardTitle className="text-xs font-medium text-slate-100 truncate" title={agent_name}>
                        {agent_name}
                    </CardTitle>
                </div>

                <Tooltip>
                    <TooltipTrigger className="shrink-0">
                        <div className={`w-2 h-2 rounded-full ${bgSTATUS_COLORS[status] || 'bg-gray-400'}`} />
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="capitalize">{status}</p>
                    </TooltipContent>
                </Tooltip>
            </CardHeader>

            <CardContent className="p-2.5 pt-1">
                {/* Status + current tool */}
                <div className="flex items-center gap-1.5 text-xs mb-1.5">
                    <Activity className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className={`capitalize font-medium ${STATUS_COLORS[status] || 'text-slate-400'}`}>{status}</span>
                    {(status === 'acting' && current_tool) && (
                        <>
                            <span className="text-slate-600">·</span>
                            <TerminalSquare className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate text-slate-300">{current_tool}</span>
                        </>
                    )}
                    {total_errors > 0 && (
                        <span className="ml-auto flex items-center gap-0.5 text-red-400 font-medium shrink-0">
                            <AlertCircle className="w-3 h-3" /> {total_errors}
                        </span>
                    )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-x-3 text-xs text-slate-400 mb-1.5">
                    <span><span className="text-slate-500">Tok:</span> <span className="font-mono text-slate-300">{formatLargeNumber(total_tokens)}</span></span>
                    {cacheRate !== null ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="cursor-default">
                                    <span className="text-slate-500">Cache:</span>{' '}
                                    <span className={`font-mono ${cacheRate >= 50 ? 'text-emerald-400' : 'text-slate-300'}`}>
                                        {cacheRate}%
                                    </span>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Cache hit rate: {cache_read_tokens?.toLocaleString()} / {((total_input_tokens ?? 0) + (cache_read_tokens ?? 0)).toLocaleString()} tokens read from cache</p>
                            </TooltipContent>
                        </Tooltip>
                    ) : null}
                    <span><span className="text-slate-500">Tools:</span> <span className="font-mono text-slate-300">{total_tool_calls}</span></span>
                </div>

                {/* Tool distribution mini bar */}
                {toolTotal > 0 && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex h-1 w-full rounded-full overflow-hidden gap-px cursor-default mb-1.5">
                                {sortedToolEntries.map(([cat, count]) => (
                                    <div
                                        key={cat}
                                        style={{
                                            width: `${(count / toolTotal) * 100}%`,
                                            backgroundColor: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] ?? '#9ca3af',
                                        }}
                                    />
                                ))}
                            </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                            <div className="flex flex-col gap-1">
                                {sortedToolEntries.map(([cat, count]) => (
                                    <div key={cat} className="flex items-center gap-2">
                                        <span
                                            className="w-2 h-2 rounded-full shrink-0"
                                            style={{ backgroundColor: CATEGORY_COLORS[cat as keyof typeof CATEGORY_COLORS] ?? '#9ca3af' }}
                                        />
                                        <span className="text-slate-300 capitalize">{cat.replace('_', ' ')}</span>
                                        <span className="text-slate-500 ml-auto">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </TooltipContent>
                    </Tooltip>
                )}

                <div className="flex items-center gap-1 text-[10px] text-slate-600 border-t border-slate-700/40 pt-1.5">
                    <Clock className="w-2.5 h-2.5 shrink-0" />
                    <span>{formatRelativeTime(session_start)}</span>
                    <span className="ml-auto">{formatRelativeTime(last_activity)}</span>
                </div>
            </CardContent>
        </Card>
    );
});
