import type { CostByAgentResponse } from '@agent-observatory/shared';
import { formatCurrency } from '../../../utils/formatters';
import { SOURCE_COLORS } from '../../../utils/colors';

const PALETTE = ['#6366f1', '#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];
const TOP_N = 6;

interface Props {
    data: CostByAgentResponse | null;
}

export function CostByAgentChart({ data }: Props) {
    if (!data || data.agents.length === 0) {
        return (
            <div className="h-24 mt-2 flex items-center justify-center text-slate-600 text-sm">
                No agent cost data
            </div>
        );
    }

    const sorted = [...data.agents].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    const top = sorted.slice(0, TOP_N);
    const others = sorted.slice(TOP_N);
    const othersTotal = others.reduce((s, a) => s + a.total_cost_usd, 0);
    const grandTotal = data.agents.reduce((s, a) => s + a.total_cost_usd, 0);

    const rows = top.map((a, i) => ({
        name: a.agent_name,
        cost: a.total_cost_usd,
        pct: grandTotal > 0 ? (a.total_cost_usd / grandTotal) * 100 : 0,
        color: SOURCE_COLORS[a.source as keyof typeof SOURCE_COLORS] || PALETTE[i % PALETTE.length],
    }));
    if (othersTotal > 0) {
        rows.push({ name: `+${others.length} others`, cost: othersTotal, pct: grandTotal > 0 ? (othersTotal / grandTotal) * 100 : 0, color: '#475569' });
    }

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-400">Cost by Agent</h3>
                <span className="text-xs text-slate-500 font-mono">{formatCurrency(grandTotal)} total</span>
            </div>
            <div className="flex flex-col gap-2">
                {rows.map((row) => (
                    <div key={row.name} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="text-slate-300 truncate flex-1 min-w-0" title={row.name}>{row.name}</span>
                        <div className="w-24 bg-slate-700 rounded-full h-1 shrink-0">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(row.pct, 100)}%`, backgroundColor: row.color }} />
                        </div>
                        <span className="text-slate-500 font-mono w-8 text-right">{row.pct.toFixed(0)}%</span>
                        <span className="text-slate-400 font-mono w-14 text-right">{formatCurrency(row.cost)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
