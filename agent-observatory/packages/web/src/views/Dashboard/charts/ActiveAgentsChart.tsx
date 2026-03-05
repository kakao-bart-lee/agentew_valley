import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface ActiveAgentsChartProps {
    data: Array<{ time: string; active: number }>;
}

export function ActiveAgentsChart({ data }: ActiveAgentsChartProps) {
    return (
        <div className="h-44 mt-2">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Active Agents (Last 60m)</h3>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="colorActive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} minTickGap={30} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} />
                    <Area type="monotone" dataKey="active" stroke="#10b981" fillOpacity={1} fill="url(#colorActive)" isAnimationActive={false} />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
