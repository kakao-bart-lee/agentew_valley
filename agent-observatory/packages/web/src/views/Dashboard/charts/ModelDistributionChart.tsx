import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getModelBadgeColor, getModelShortName } from '../../../utils/colors';

interface ModelDistributionChartProps {
    data: Record<string, { agent_count: number; token_count: number }>;
}

export function ModelDistributionChart({ data }: ModelDistributionChartProps) {
    const chartData = Object.entries(data)
        .filter(([, v]) => v.agent_count > 0 || v.token_count > 0)
        .sort(([, a], [, b]) => b.token_count - a.token_count)
        .map(([modelId, v]) => ({
            name: getModelShortName(modelId),
            modelId,
            agents: v.agent_count,
            tokens: v.token_count,
            color: getModelBadgeColor(modelId),
        }));

    if (chartData.length === 0) {
        return (
            <div className="h-32 flex items-center justify-center text-slate-600 text-sm">
                No model data yet
            </div>
        );
    }

    return (
        <div>
            <h3 className="text-sm font-medium text-slate-400 mb-3">Model Distribution</h3>
            {/* 모델별 토큰 바 차트 */}
            <div className="h-36 mb-3">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                        <XAxis type="number" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={52} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', fontSize: 12 }}
                            formatter={(value: number | undefined, name: string | undefined) => [
                                name === 'tokens' ? (value ?? 0).toLocaleString() : (value ?? 0),
                                name === 'tokens' ? 'Tokens' : 'Agents',
                            ]}
                        />
                        <Bar dataKey="tokens" radius={[0, 3, 3, 0]}>
                            {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {/* 모델별 에이전트 수 뱃지 요약 */}
            <div className="flex flex-wrap gap-1.5">
                {chartData.map(({ name, modelId, agents, tokens }) => (
                    <div
                        key={modelId}
                        className="flex items-center gap-1.5 bg-slate-700/50 rounded px-2 py-1"
                        title={`${modelId}: ${agents} agent${agents !== 1 ? 's' : ''}, ${tokens.toLocaleString()} tokens`}
                    >
                        <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: getModelBadgeColor(modelId) }}
                        />
                        <span className="text-xs text-slate-300 font-medium">{name}</span>
                        <span className="text-[10px] text-slate-500">{agents}a</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
