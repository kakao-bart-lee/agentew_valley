import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { SOURCE_COLORS } from '../../../utils/colors';

interface SourceDistributionProps {
    data: Array<{ name: string; value: number }>;
}

export function SourceDistribution({ data }: SourceDistributionProps) {
    return (
        <div className="h-48 mt-2 flex flex-col items-center">
            <h3 className="text-sm font-medium text-slate-400 mb-2 self-start">Agent Sources</h3>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%" cy="50%" innerRadius="60%" outerRadius="80%" paddingAngle={2} dataKey="value"
                    >
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={SOURCE_COLORS[entry.name as keyof typeof SOURCE_COLORS] || '#9ca3af'} />
                        ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
}
