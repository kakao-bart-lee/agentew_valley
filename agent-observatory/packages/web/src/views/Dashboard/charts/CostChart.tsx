import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface CostChartProps {
    data: Array<{ time: string; cost: number }>;
}

export function CostChart({ data }: CostChartProps) {
    return (
        <div className="h-44 mt-2">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Cost / Hour (Last 60m)</h3>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <LineChart data={data}>
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} minTickGap={30} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={40} tickFormatter={(value) => `$${value.toFixed(2)}`} />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                        formatter={(value: any) => [`$${(value || 0).toFixed(4)}`, 'Cost/hr']}
                    />
                    <Line type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
