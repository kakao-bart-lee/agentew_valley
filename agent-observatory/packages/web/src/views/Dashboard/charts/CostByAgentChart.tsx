import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { CostByAgentResponse } from '@agent-observatory/shared';
import { formatCurrency } from '../../../utils/formatters';
import { SOURCE_COLORS } from '../../../utils/colors';

const BASE_URL = import.meta.env?.VITE_WEBSOCKET_URL || 'http://localhost:3000';
const PALETTE = ['#6366f1', '#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#3b82f6'];

export function CostByAgentChart() {
    const [data, setData] = useState<CostByAgentResponse | null>(null);

    useEffect(() => {
        fetch(`${BASE_URL}/api/v1/analytics/cost/by-agent`)
            .then(res => res.json())
            .then(setData)
            .catch(() => null);
    }, []);

    if (!data || data.agents.length === 0) {
        return (
            <div className="h-44 mt-2 flex items-center justify-center text-slate-600 text-sm">
                No agent cost data
            </div>
        );
    }

    const pieData = data.agents.map((a, i) => ({
        name: a.agent_name,
        value: parseFloat(a.total_cost_usd.toFixed(4)),
        color: SOURCE_COLORS[a.source as keyof typeof SOURCE_COLORS] || PALETTE[i % PALETTE.length],
        pct: a.cost_percentage,
    }));

    return (
        <div className="mt-2">
            <h3 className="text-sm font-medium text-slate-400 mb-2">Cost by Agent</h3>
            <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={35}>
                            {pieData.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: 11 }}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [`${formatCurrency(value)} (${pieData.find(d => d.name === name)?.pct.toFixed(1)}%)`, name]) as any}
                        />
                        <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
