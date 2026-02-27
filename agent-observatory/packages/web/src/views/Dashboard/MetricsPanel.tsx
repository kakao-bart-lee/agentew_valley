import { useMetricsStore } from '../../stores/metricsStore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie } from 'recharts';
import { CATEGORY_COLORS, SOURCE_COLORS } from '../../utils/colors';

export function MetricsPanel() {
    const { snapshot } = useMetricsStore();

    if (!snapshot) {
        return <div className="flex h-full items-center justify-center text-slate-500">Waiting for metrics...</div>;
    }

    // Formatting timeseries for Recharts
    const timeseriesData = snapshot.timeseries.timestamps.map((ts, i) => {
        const timeLabel = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return {
            time: timeLabel,
            tokens: snapshot.timeseries.tokens_per_minute[i],
            cost: snapshot.timeseries.cost_per_minute[i] * 60, // Per hour estimate
        };
    });

    const toolData = Object.entries(snapshot.tool_distribution)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => ({ name: key, value }))
        .sort((a, b) => b.value - a.value); // highest first

    return (
        <div className="flex flex-col gap-6 h-full overflow-y-auto pr-2 custom-scrollbar">

            {/* 1. Tokens per minute line chart */}
            <div className="h-44">
                <h3 className="text-sm font-medium text-slate-400 mb-2">Tokens / Minute (Last 60m)</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeseriesData}>
                        <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} minTickGap={30} />
                        <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} width={40} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} />
                        <Line type="monotone" dataKey="tokens" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* 2. Tool Distribution horizontal bar chart */}
            <div className="h-48 mt-2">
                <h3 className="text-sm font-medium text-slate-400 mb-2">Tool Category Distribution</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={toolData} layout="vertical" margin={{ left: 20 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={11} axisLine={false} tickLine={false} width={80} />
                        <Tooltip cursor={{ fill: '#334155' }} contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                            {toolData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.name as keyof typeof CATEGORY_COLORS] || '#9ca3af'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* 3. Source Distribution Pie Chart */}
            <div className="h-40 mt-2 flex flex-col items-center">
                <h3 className="text-sm font-medium text-slate-400 mb-2 self-start">Agent Sources</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={Object.entries(snapshot.source_distribution).filter(([_, v]) => v > 0).map(([k, v]) => ({ name: k, value: v }))}
                            cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2} dataKey="value"
                        >
                            {Object.entries(snapshot.source_distribution).map(([k], index) => (
                                <Cell key={`cell-${index}`} fill={SOURCE_COLORS[k as keyof typeof SOURCE_COLORS] || '#9ca3af'} />
                            ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
