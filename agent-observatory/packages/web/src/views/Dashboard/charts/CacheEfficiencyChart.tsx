import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface CacheEfficiencyChartProps {
    data: Array<{ time: string; cacheRate: number; llmResponses: number }>;
}

export function CacheEfficiencyChart({ data }: CacheEfficiencyChartProps) {
    const hasData = data.some(d => d.cacheRate > 0 || d.llmResponses > 0);

    if (!hasData) {
        return (
            <div className="h-32 flex items-center justify-center text-slate-600 text-sm">
                No cache data yet
            </div>
        );
    }

    return (
        <div>
            <h3 className="text-sm font-medium text-slate-400 mb-2">Cache Hit Rate (Last 60m)</h3>
            <div className="h-36">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="cacheGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} minTickGap={30} />
                        <YAxis
                            stroke="#64748b"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            width={36}
                            domain={[0, 1]}
                            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: 12 }}
                            formatter={(value: number | undefined) => [`${Math.round((value ?? 0) * 100)}%`, 'Cache Hit Rate']}
                        />
                        <Area
                            type="monotone"
                            dataKey="cacheRate"
                            stroke="#10b981"
                            strokeWidth={2}
                            fill="url(#cacheGrad)"
                            dot={false}
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
