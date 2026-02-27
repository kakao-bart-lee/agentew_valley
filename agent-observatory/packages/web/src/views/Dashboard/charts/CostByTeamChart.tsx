import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { CostByTeamResponse } from '@agent-observatory/shared';
import { formatCurrency } from '../../../utils/formatters';

const BASE_URL = import.meta.env?.VITE_WEBSOCKET_URL || 'http://localhost:3000';
const PALETTE = ['#6366f1', '#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];

export function CostByTeamChart() {
    const [data, setData] = useState<CostByTeamResponse | null>(null);

    useEffect(() => {
        fetch(`${BASE_URL}/api/v1/analytics/cost/by-team`)
            .then(res => res.json())
            .then(setData)
            .catch(() => null);
    }, []);

    if (!data || data.teams.length === 0) {
        return (
            <div className="h-36 mt-2 flex items-center justify-center text-slate-600 text-sm">
                No team cost data
            </div>
        );
    }

    const barData = data.teams.map(t => ({
        name: t.team_id,
        cost: parseFloat(t.total_cost_usd.toFixed(4)),
        pct: t.cost_percentage,
    }));

    return (
        <div className="mt-2">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Cost by Team</h3>
            <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 30 }}>
                        <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} width={70} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: 11 }}
                            formatter={((value: number, _: string, props: any) => [`${formatCurrency(value)} (${props.payload?.pct?.toFixed(1)}%)`, 'Cost']) as any}
                        />
                        <Bar dataKey="cost" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                            {barData.map((_, i) => (
                                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
