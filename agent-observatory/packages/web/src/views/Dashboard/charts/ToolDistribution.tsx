import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CATEGORY_COLORS } from '../../../utils/colors';

interface ToolDistributionProps {
    data: Array<{ name: string; value: number }>;
}

export function ToolDistribution({ data }: ToolDistributionProps) {
    return (
        <div className="h-48 mt-2">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Tool Category Distribution</h3>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} width={80} />
                    <Tooltip cursor={{ fill: '#334155' }} contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.name as keyof typeof CATEGORY_COLORS] || '#9ca3af'} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
