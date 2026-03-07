import type { CostByTeamResponse } from '@agent-observatory/shared';
import { formatCurrency } from '../../../utils/formatters';

const PALETTE = ['#6366f1', '#f97316', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b'];

interface Props {
    data: CostByTeamResponse | null;
}

export function CostByTeamChart({ data }: Props) {
    if (!data || data.teams.length === 0) {
        return (
            <div className="h-36 mt-2 flex items-center justify-center text-slate-600 text-sm">
                No team cost data
            </div>
        );
    }

    // top 6 + others
    const sorted = [...data.teams].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
    const grandTotal = data.teams.reduce((s, t) => s + t.total_cost_usd, 0);
    const top = sorted.slice(0, 6);
    const others = sorted.slice(6);
    const othersTotal = others.reduce((s, t) => s + t.total_cost_usd, 0);

    const rows = top.map(t => ({
        name: t.team_id,
        cost: t.total_cost_usd,
        pct: grandTotal > 0 ? (t.total_cost_usd / grandTotal) * 100 : 0,
    }));
    if (othersTotal > 0) {
        rows.push({ name: `+${others.length} others`, cost: othersTotal, pct: grandTotal > 0 ? (othersTotal / grandTotal) * 100 : 0 });
    }

    return (
        <div className="mt-2">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-400">Cost by Project</h3>
                <span className="text-xs text-slate-500 font-mono">{formatCurrency(grandTotal)} total</span>
            </div>
            <div className="flex flex-col gap-2">
                {rows.map((row, i) => (
                    <div key={row.name} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                        <span className="text-slate-300 truncate flex-1 min-w-0" title={row.name}>{row.name}</span>
                        <div className="w-24 bg-slate-700 rounded-full h-1 shrink-0">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(row.pct, 100)}%`, backgroundColor: PALETTE[i % PALETTE.length] }} />
                        </div>
                        <span className="text-slate-500 font-mono w-8 text-right">{row.pct.toFixed(0)}%</span>
                        <span className="text-slate-400 font-mono w-14 text-right">{formatCurrency(row.cost)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
