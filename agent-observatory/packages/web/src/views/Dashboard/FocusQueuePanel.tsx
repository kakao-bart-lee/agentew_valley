import { useMemo, useState, useEffect } from 'react';
import { AlertCircle, Clock3, TerminalSquare } from 'lucide-react';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentLiveState } from '../../types/agent';
import { matchesAgentActivityScope } from '../../utils/agentActivity';
import { formatRelativeTime } from '../../utils/formatters';
import { SOURCE_COLORS, SOURCE_LABELS, STATUS_COLORS } from '../../utils/colors';

interface FocusQueuePanelProps {
    selectedAgentId: string | null;
    onSelectAgent: (agentId: string) => void;
}

function scoreAgent(agent: AgentLiveState, now: number): number {
    let score = 0;

    if (matchesAgentActivityScope(agent, 'live', now)) score += 80;
    if (agent.status === 'error' || agent.last_run_status === 'error') score += 90;
    if (agent.status === 'waiting_input' || agent.status === 'waiting_permission') score += 70;
    if (agent.status === 'acting' || agent.status === 'thinking') score += 50;
    if (agent.health_status === 'error') score += 60;
    if (agent.health_status === 'caution') score += 25;
    if (agent.last_error) score += 20;
    score += Math.min(agent.total_errors ?? 0, 8) * 3;

    return score;
}

function summarizeAgent(agent: AgentLiveState): string {
    return agent.last_error
        ?? agent.status_detail
        ?? agent.current_tool
        ?? (agent.status === 'acting' ? 'Working on a tool step' : 'Recently active');
}

export function FocusQueuePanel({
    selectedAgentId,
    onSelectAgent,
}: FocusQueuePanelProps) {
    const { agents, sourceFilter, statusFilter } = useAgentStore();
    const [activityNow, setActivityNow] = useState(() => Date.now());

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setActivityNow(Date.now());
        }, 30_000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    const focusAgents = useMemo(() => {
        let list = Array.from(agents.values());
        if (sourceFilter.length > 0) list = list.filter((agent) => sourceFilter.includes(agent.source));
        if (statusFilter.length > 0) list = list.filter((agent) => statusFilter.includes(agent.status));

        return list
            .map((agent) => ({ agent, score: scoreAgent(agent, activityNow) }))
            .filter(({ agent, score }) => (
                agent.agent_id === selectedAgentId ||
                (score > 0 && matchesAgentActivityScope(agent, 'recent', activityNow))
            ))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return Date.parse(b.agent.last_activity) - Date.parse(a.agent.last_activity);
            })
            .slice(0, 6)
            .map(({ agent }) => agent);
    }, [activityNow, agents, selectedAgentId, sourceFilter, statusFilter]);

    return (
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-700 bg-slate-800 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-pretty">Run Highlights</h2>
                    <p className="mt-1 text-xs text-slate-400">Live, blocked, or error-prone agents surfaced first.</p>
                </div>
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-400">
                    {focusAgents.length} shown
                </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                {focusAgents.length === 0 ? (
                    <div className="flex h-full min-h-[8rem] items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-4 text-center text-sm text-slate-500">
                        No live or attention-worthy agents match the current filters.
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {focusAgents.map((agent) => (
                            <button
                                key={agent.agent_id}
                                type="button"
                                onClick={() => onSelectAgent(agent.agent_id)}
                                className={`flex w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors ${
                                    agent.agent_id === selectedAgentId
                                        ? 'border-indigo-500 bg-slate-900/90 ring-1 ring-indigo-500/40'
                                        : 'border-slate-700 bg-slate-900/60 hover:border-slate-500 hover:bg-slate-900/80'
                                }`}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span
                                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                                        style={{ backgroundColor: SOURCE_COLORS[agent.source] || '#9ca3af' }}
                                    >
                                        {SOURCE_LABELS[agent.source] || '?'}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                                        {agent.agent_name}
                                    </span>
                                    <span className={`shrink-0 text-xs font-medium capitalize ${STATUS_COLORS[agent.status] || 'text-slate-400'}`}>
                                        {agent.status}
                                    </span>
                                </div>

                                <div className="flex min-w-0 items-start gap-2 text-xs text-slate-400">
                                    {agent.current_tool ? <TerminalSquare aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" /> : <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />}
                                    <span className="min-w-0 flex-1 break-words text-slate-300">
                                        {summarizeAgent(agent)}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                                    <Clock3 aria-hidden="true" className="h-3 w-3 shrink-0" />
                                    <span>{formatRelativeTime(agent.last_activity)}</span>
                                    {agent.total_errors > 0 && (
                                        <span className="ml-auto rounded bg-red-950/50 px-1.5 py-0.5 text-red-300">
                                            {agent.total_errors} error{agent.total_errors === 1 ? '' : 's'}
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
