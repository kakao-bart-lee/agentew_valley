import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { CostByToolResponse } from '@agent-observatory/shared';
import { formatCurrency } from '../../../utils/formatters';
import { CATEGORY_COLORS } from '../../../utils/colors';

interface Props {
    data: CostByToolResponse | null;
}

export function CostByToolChart({ data }: Props) {
    if (!data || data.tools.length === 0) {
        return (
            <div className="h-44 mt-2 flex items-center justify-center text-slate-600 text-sm">
                No tool cost data
            </div>
        );
    }

    const barData = data.tools
        .filter(t => t.estimated_cost_usd > 0)
        .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd)
        .map(t => ({
            name: t.tool_category,
            cost: parseFloat(t.estimated_cost_usd.toFixed(5)),
            calls: t.call_count,
            pct: t.cost_percentage,
        }));

    return (
        <div className="mt-2">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Est. Cost by Tool Category</h3>
            <div className="h-44">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                    <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 40 }}>
                        <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} tickFormatter={v => `$${v.toFixed(4)}`} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} width={80} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: 11 }}
                            formatter={((value: number, _: string, props: any) => [
                                `${formatCurrency(value)} (${props.payload?.pct?.toFixed(1)}%) · ${props.payload?.calls} calls`,
                                'Est. Cost'
                            ]) as any}
                        />
                        <Bar dataKey="cost" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                            {barData.map((entry, i) => (
                                <Cell key={i} fill={CATEGORY_COLORS[entry.name as keyof typeof CATEGORY_COLORS] || '#6366f1'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
