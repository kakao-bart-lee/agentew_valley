import { useEffect, useState } from 'react';
import type { SessionSummary } from '@agent-observatory/shared';
import { Badge } from '../../components/ui/badge';
import { formatCurrency, formatLargeNumber, formatRelativeTime } from '../../utils/formatters';
import { SOURCE_COLORS, SOURCE_LABELS } from '../../utils/colors';
import { Clock, Layers, Server, ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { getApiBase } from '../../lib/api';

const BASE_URL = getApiBase();

interface SessionListViewProps {
    onSelectSession: (sessionId: string) => void;
}

function formatDuration(startTime: string, endTime?: string): string {
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    const ms = end - start;
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export function SessionListView({ onSelectSession }: SessionListViewProps) {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSessions = () => {
        setLoading(true);
        setError(null);
        fetch(`${BASE_URL}/api/v1/sessions?limit=50`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                setSessions(data.sessions || []);
                setTotal(data.total || 0);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchSessions(); }, []);

    return (
        <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50 p-4 md:p-6">
            <div className="mx-auto w-full max-w-5xl">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Session History</h1>
                        <p className="text-slate-400 text-sm mt-1">{total} sessions recorded</p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchSessions}
                        className="text-slate-400 hover:text-white gap-2"
                        disabled={loading}
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>

                {/* Error state */}
                {error && (
                    <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mb-4 text-red-400 text-sm">
                        Failed to load sessions: {error}. Make sure the server is running on {BASE_URL}.
                    </div>
                )}

                {/* Loading skeleton */}
                {loading && (
                    <div className="flex flex-col gap-3">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="bg-slate-800 rounded-xl border border-slate-700 p-4 animate-pulse">
                                <div className="flex items-center justify-between">
                                    <div className="flex flex-col gap-2">
                                        <div className="h-4 w-32 bg-slate-700 rounded" />
                                        <div className="h-3 w-24 bg-slate-700 rounded" />
                                    </div>
                                    <div className="h-4 w-16 bg-slate-700 rounded" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {!loading && !error && sessions.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-24 text-slate-500">
                        <Clock className="w-12 h-12 mb-4 opacity-30" />
                        <p className="text-lg font-medium">No sessions recorded yet</p>
                        <p className="text-sm mt-1">Sessions appear here once agents start running.</p>
                    </div>
                )}

                {/* Session list */}
                {!loading && sessions.length > 0 && (
                    <div className="flex flex-col gap-3">
                        {sessions.map(session => (
                            <button
                                key={session.session_id}
                                onClick={() => onSelectSession(session.session_id)}
                                className="bg-slate-800 rounded-xl border border-slate-700 p-4 text-left hover:border-indigo-500/60 hover:bg-slate-700/50 transition-all group flex items-center justify-between gap-4"
                            >
                                <div className="flex flex-col gap-2 flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Badge
                                            variant="outline"
                                            className="text-white border-transparent text-[10px] px-1.5 py-0 h-4 shrink-0"
                                            style={{ backgroundColor: SOURCE_COLORS[session.source as keyof typeof SOURCE_COLORS] || '#9ca3af' }}
                                        >
                                            {SOURCE_LABELS[session.source as keyof typeof SOURCE_LABELS] || 'Custom'}
                                        </Badge>
                                        {session.team_id && (
                                            <Badge variant="outline" className="border-slate-600 text-slate-300 text-[10px] px-1.5 py-0 h-4 bg-slate-700/50 shrink-0">
                                                {session.team_id}
                                            </Badge>
                                        )}
                                        {!session.end_time && (
                                            <Badge variant="outline" className="border-emerald-700 text-emerald-400 text-[10px] px-1.5 py-0 h-4 bg-emerald-900/20 shrink-0">
                                                Live
                                            </Badge>
                                        )}
                                        <span className="font-semibold text-slate-100 truncate">{session.agent_name}</span>
                                    </div>

                                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400">
                                        <div className="flex items-center gap-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            <span>{formatRelativeTime(session.start_time)}</span>
                                            <span className="text-slate-600 mx-1">·</span>
                                            <span className="text-slate-500">{formatDuration(session.start_time, session.end_time)}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Layers className="w-3.5 h-3.5" />
                                            <span>{session.total_events.toLocaleString()} events</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-slate-500">Tokens:</span>
                                            <span>{formatLargeNumber(session.total_tokens)}</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Server className="w-3.5 h-3.5" />
                                            <span className="text-emerald-400">{formatCurrency(session.total_cost_usd)}</span>
                                        </div>
                                    </div>
                                </div>

                                <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-indigo-400 shrink-0 transition-colors" />
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
