import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { TokenAnalyticsResponse } from '@agent-observatory/shared';
import { formatLargeNumber } from '../../../utils/formatters';

interface Props {
    data: TokenAnalyticsResponse | null;
}

export function TokensAnalyticsChart({ data }: Props) {
    if (!data || data.tokens_timeseries.length === 0) {
        return (
            <div className="h-36 mt-2 flex items-center justify-center text-slate-600 text-sm">
                No token analytics data
            </div>
        );
    }

    const chartData = data.tokens_timeseries.map(d => ({
        time: new Date(d.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tokens: d.tokens,
    }));

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-slate-400">Token Usage (Historical)</h3>
                <span className="text-xs text-slate-500 font-mono">Total: {formatLargeNumber(data.total_tokens)}</span>
            </div>
            <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="time" stroke="#64748b" fontSize={10} tickLine={false} minTickGap={30} />
                        <YAxis stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} width={40} tickFormatter={v => formatLargeNumber(v)} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: 11 }}
                            formatter={((v: number) => [formatLargeNumber(v), 'Tokens']) as any}
                        />
                        <Area type="monotone" dataKey="tokens" stroke="#6366f1" fill="url(#tokenGradient)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Per-agent breakdown */}
            {data.by_agent.length > 0 && (
                <div className="mt-3 flex flex-col gap-1">
                    {data.by_agent.slice(0, 5).map(a => {
                        const pct = data.total_tokens > 0 ? (a.total_tokens / data.total_tokens) * 100 : 0;
                        return (
                            <div key={a.agent_id} className="flex items-center gap-2 text-xs">
                                <span className="text-slate-400 truncate flex-1 min-w-0">{a.agent_name}</span>
                                <div className="w-20 bg-slate-700 rounded-full h-1.5 shrink-0">
                                    <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-slate-500 font-mono w-10 text-right">{formatLargeNumber(a.total_tokens)}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
