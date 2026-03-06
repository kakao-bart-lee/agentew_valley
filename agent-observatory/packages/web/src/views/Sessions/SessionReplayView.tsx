import { useEffect, useState, useRef, useCallback } from 'react';
import type { SessionReplayResponse, ReplayEvent } from '@agent-observatory/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import { formatCurrency } from '../../utils/formatters';
import { SOURCE_COLORS, SOURCE_LABELS } from '../../utils/colors';
import { ArrowLeft, Play, Pause, SkipBack, Gauge, Clock, Layers, Server, TerminalSquare } from 'lucide-react';
import { getApiBase } from '../../lib/api';

const BASE_URL = getApiBase();

const SPEEDS = [0.5, 1, 2, 5, 10] as const;

interface SessionReplayViewProps {
    sessionId: string;
    onBack: () => void;
}

function formatMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatOffsetBar(offsetMs: number, durationMs: number): number {
    if (durationMs <= 0) return 0;
    return Math.min(100, (offsetMs / durationMs) * 100);
}

function eventTypeColor(type: string): string {
    if (type.startsWith('tool.')) return 'text-amber-400';
    if (type === 'agent.status') return 'text-blue-400';
    if (type === 'session.start') return 'text-emerald-400';
    if (type === 'session.end') return 'text-slate-400';
    if (type === 'user.input') return 'text-indigo-400';
    if (type.startsWith('subagent.')) return 'text-purple-400';
    return 'text-slate-300';
}

function eventIcon(type: string): string {
    const icons: Record<string, string> = {
        'tool.start': '→',
        'tool.end': '✓',
        'tool.error': '✗',
        'agent.status': '⚡',
        'session.start': '▶',
        'session.end': '⏹',
        'user.input': '💬',
        'user.permission': '🔐',
        'subagent.spawn': '🔀',
        'subagent.end': '🔀',
    };
    return icons[type] || '•';
}

export function SessionReplayView({ sessionId, onBack }: SessionReplayViewProps) {
    const [replayData, setReplayData] = useState<SessionReplayResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Playback state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [speedIdx, setSpeedIdx] = useState(1); // default 1x
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const speed = SPEEDS[speedIdx];
    const events = replayData?.events ?? [];
    const summary = replayData?.summary;
    const durationMs = summary?.duration_ms ?? 0;
    const currentOffset = events[currentIndex]?.offset_ms ?? 0;

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetch(`${BASE_URL}/api/v1/sessions/${sessionId}/replay?limit=500`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data: SessionReplayResponse) => {
                setReplayData(data);
                setCurrentIndex(0);
                setIsPlaying(false);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [sessionId]);

    // currentIndex를 ref로도 유지 — 재생 시작 시 최신값을 읽기 위해 (effect 의존성에서 제외)
    const currentIndexRef = useRef(currentIndex);
    currentIndexRef.current = currentIndex;

    // Playback loop: scheduleNext는 재귀적으로 다음 스텝을 예약
    const scheduleNext = useCallback((idx: number, evts: ReplayEvent[]) => {
        if (idx >= evts.length - 1) {
            setIsPlaying(false);
            return;
        }
        const nextGapMs = evts[idx + 1].gap_ms;
        const delay = Math.max(50, nextGapMs / speed);
        timerRef.current = setTimeout(() => {
            setCurrentIndex(prev => {
                const next = prev + 1;
                scheduleNext(next, evts);
                return next;
            });
        }, delay);
    }, [speed]);

    // isPlaying/speed 변경 시에만 effect 재실행 — currentIndex 변경은 무시
    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (isPlaying && events.length > 0) {
            scheduleNext(currentIndexRef.current, events);
        }
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, [isPlaying, events, scheduleNext]); // currentIndex 의존성 제거

    const handlePlayPause = () => {
        if (currentIndex >= events.length - 1) {
            setCurrentIndex(0);
            setIsPlaying(true);
        } else {
            setIsPlaying(p => !p);
        }
    };

    const handleReset = () => {
        setIsPlaying(false);
        if (timerRef.current) clearTimeout(timerRef.current);
        setCurrentIndex(0);
    };

    // Scroll active event into view
    useEffect(() => {
        if (scrollRef.current) {
            const activeEl = scrollRef.current.querySelector('[data-active="true"]');
            activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [currentIndex]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-slate-900">
                <div className="flex flex-col items-center gap-3 text-slate-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
                    <span className="text-sm">Loading session replay...</span>
                </div>
            </div>
        );
    }

    if (error || !replayData) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 text-slate-400 gap-4">
                <p className="text-red-400">Failed to load session: {error}</p>
                <Button variant="ghost" onClick={onBack} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back to Sessions
                </Button>
            </div>
        );
    }

    const visibleEvents = events.slice(0, currentIndex + 1);
    const progressPct = formatOffsetBar(currentOffset, durationMs);

    return (
        <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50">
            {/* Top bar */}
            <div className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-10">
                <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-slate-400 hover:text-white shrink-0">
                        <ArrowLeft className="w-4 h-4" /> Sessions
                    </Button>
                    <div className="w-px h-5 bg-slate-700" />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Badge
                            variant="outline"
                            className="text-white border-transparent text-[10px] px-1.5 py-0 h-4 shrink-0"
                            style={{ backgroundColor: SOURCE_COLORS[summary?.source as keyof typeof SOURCE_COLORS] || '#9ca3af' }}
                        >
                            {SOURCE_LABELS[summary?.source as keyof typeof SOURCE_LABELS] || 'Custom'}
                        </Badge>
                        <span className="font-semibold text-slate-100 truncate">{summary?.agent_name}</span>
                        {summary?.team_id && (
                            <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px] px-1.5 py-0 h-4 shrink-0">
                                {summary.team_id}
                            </Badge>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-6">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { icon: Clock, label: 'Duration', value: formatMs(durationMs) },
                        { icon: Layers, label: 'Events', value: `${events.length.toLocaleString()}` },
                        { icon: TerminalSquare, label: 'Tool Calls', value: `${summary?.total_tool_calls ?? 0}` },
                        { icon: Server, label: 'Cost', value: formatCurrency(summary?.total_cost_usd ?? 0), className: 'text-emerald-400' },
                    ].map(({ icon: Icon, label, value, className }) => (
                        <div key={label} className="bg-slate-800 rounded-lg border border-slate-700 p-3 flex items-center gap-3">
                            <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                            <div>
                                <div className="text-xs text-slate-500">{label}</div>
                                <div className={`font-mono font-medium text-sm ${className || 'text-slate-100'}`}>{value}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Event type distribution mini-map */}
                {Object.keys(summary?.event_type_counts ?? {}).length > 0 && (
                    <div className="bg-slate-800 rounded-lg border border-slate-700 p-3">
                        <div className="text-xs text-slate-400 mb-2">Event Distribution</div>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(summary!.event_type_counts)
                                .sort(([, a], [, b]) => b - a)
                                .map(([type, count]) => (
                                    <div key={type} className="flex items-center gap-1.5 bg-slate-700/50 rounded px-2 py-1">
                                        <span className={`text-xs font-mono ${eventTypeColor(type)}`}>{eventIcon(type)}</span>
                                        <span className="text-xs text-slate-300">{type}</span>
                                        <span className="text-xs text-slate-500 font-mono">{count}</span>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}

                {/* Playback controls */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col gap-3">
                    {/* Progress bar */}
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500 font-mono w-16 text-right">{formatMs(currentOffset)}</span>
                        <div className="flex-1 bg-slate-700 rounded-full h-2 relative overflow-hidden">
                            <div
                                className="bg-indigo-500 h-full rounded-full transition-all duration-100"
                                style={{ width: `${progressPct}%` }}
                            />
                        </div>
                        <span className="text-xs text-slate-500 font-mono w-16">{formatMs(durationMs)}</span>
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-white" onClick={handleReset} title="Reset">
                                <SkipBack className="h-4 w-4" />
                            </Button>
                            <Button
                                size="icon"
                                className="h-9 w-9 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full"
                                onClick={handlePlayPause}
                                title={isPlaying ? 'Pause' : 'Play'}
                            >
                                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            </Button>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Gauge className="w-3.5 h-3.5" />
                            <span>Speed:</span>
                            <div className="flex gap-1">
                                {SPEEDS.map((s, i) => (
                                    <button
                                        key={s}
                                        onClick={() => setSpeedIdx(i)}
                                        className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${i === speedIdx ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                                    >
                                        {s}x
                                    </button>
                                ))}
                            </div>
                        </div>

                        <span className="text-xs text-slate-500 font-mono">
                            {currentIndex + 1} / {events.length}
                        </span>
                    </div>
                </div>

                {/* Event timeline */}
                <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-700 text-sm font-semibold text-slate-300">
                        Event Timeline
                    </div>
                    <ScrollArea className="h-[400px]">
                        <div ref={scrollRef} className="flex flex-col divide-y divide-slate-700/50">
                            {visibleEvents.map((re, i) => {
                                const isActive = i === currentIndex;
                                const ev = re.event;
                                return (
                                    <div
                                        key={ev.event_id || i}
                                        data-active={isActive ? 'true' : undefined}
                                        className={`flex items-start gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? 'bg-indigo-900/20 border-l-2 border-indigo-500' : 'border-l-2 border-transparent'}`}
                                    >
                                        <span className="text-slate-500 font-mono text-xs min-w-[52px] pt-0.5">
                                            {formatMs(re.offset_ms)}
                                        </span>
                                        <span className={`font-mono text-sm pt-0.5 shrink-0 ${eventTypeColor(ev.type)}`}>
                                            {eventIcon(ev.type)}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-slate-400 text-xs">{ev.type}</span>
                                            {Boolean(ev.data?.tool_name) && (
                                                <span className="text-slate-300 ml-2 text-xs font-medium">{String(ev.data!.tool_name)}</span>
                                            )}
                                            {Boolean(ev.data?.tool_input_summary) && (
                                                <div className="text-slate-500 text-xs mt-0.5 truncate">{String(ev.data!.tool_input_summary)}</div>
                                            )}
                                            {Boolean(ev.data?.status) && (
                                                <span className="text-slate-300 ml-2 text-xs">{String(ev.data!.status)}</span>
                                            )}
                                        </div>
                                        {re.gap_ms > 0 && (
                                            <span className="text-slate-600 text-[10px] font-mono shrink-0 pt-0.5">+{formatMs(re.gap_ms)}</span>
                                        )}
                                    </div>
                                );
                            })}
                            {visibleEvents.length === 0 && (
                                <div className="py-12 text-center text-slate-500 text-sm">
                                    Press play to start replay
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                </div>

            </div>
        </div>
    );
}
