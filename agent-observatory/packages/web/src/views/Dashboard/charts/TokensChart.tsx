import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface TokensChartProps {
    data: Array<{ time: string; tokens: number }>;
}

export function TokensChart({ data }: TokensChartProps) {
    return (
        <div className="h-44">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Tokens / Minute (Last 60m)</h3>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                    <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} minTickGap={30} />
                    <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={40} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} />
                    <Line type="monotone" dataKey="tokens" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}
