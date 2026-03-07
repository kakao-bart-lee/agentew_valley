import { useState, useEffect, useRef } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import type { AgentLiveState } from '../../types/agent';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface AisLogSnapshot {
    agent_id: string;
    worktree_path: string;
    lines: string[];
    total_lines: number;
    truncated: boolean;
    updated_at: string;
}

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function formatTs(iso: string) {
    return new Intl.DateTimeFormat('ko', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
}

const THINKING_STATE_COLORS: Record<string, string> = {
    planning: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30',
    coding: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/30',
    validating: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    investigating: 'text-violet-400 bg-violet-400/10 border-violet-400/30',
};

const STATUS_COLORS: Record<string, string> = {
    running: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
    attention: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
};

function getAisStatus(agent: AgentLiveState): 'running' | 'attention' {
    return agent.status === 'waiting_permission' || agent.status === 'error' ? 'attention' : 'running';
}

function getThinkingState(agent: AgentLiveState): string {
    const detail = agent.status_detail?.toLowerCase() ?? '';
    if (/test|valid|review|qa/.test(detail)) return 'validating';
    if (/plan|design|spec|schema/.test(detail)) return 'planning';
    if (/debug|invest|triage|inspect/.test(detail)) return 'investigating';
    return 'coding';
}

// ─── 세션 카드 ─────────────────────────────────────────────────────────────────

function SessionCard({
    agent,
    isSelected,
    onClick,
}: {
    agent: AgentLiveState;
    isSelected: boolean;
    onClick: () => void;
}) {
    const issueId = agent.task_context?.issue_identifier ?? agent.agent_id.replace('ais-', '').toUpperCase();
    const thinkingState = getThinkingState(agent);
    const aisStatus = getAisStatus(agent);

    return (
        <button
            type="button"
            aria-pressed={isSelected}
            onClick={onClick}
            className={`w-full rounded-xl border px-4 py-3 text-left transition-all ${
                isSelected
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-slate-700 bg-slate-800/60 hover:border-slate-600 hover:bg-slate-800'
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        {issueId}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-200 line-clamp-1">
                        {agent.agent_name ?? agent.agent_id}
                    </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${THINKING_STATE_COLORS[thinkingState] ?? ''}`}>
                    {thinkingState}
                </span>
            </div>
            <p className="mt-2 text-xs text-slate-400 line-clamp-2">
                {agent.status_detail ?? '작업 중...'}
            </p>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                <span className={`rounded-full border px-2 py-0.5 uppercase tracking-wider font-semibold ${STATUS_COLORS[aisStatus]}`}>
                    {aisStatus}
                </span>
                <span>{formatTs(agent.last_activity)}</span>
            </div>
        </button>
    );
}

// ─── 세션 상세 ─────────────────────────────────────────────────────────────────

function SessionDetail({ agent }: { agent: AgentLiveState }) {
    const issueId = agent.task_context?.issue_identifier ?? agent.agent_id.replace('ais-', '').toUpperCase();
    const title = agent.task_context?.title ?? agent.agent_name ?? agent.agent_id;
    const thinkingState = getThinkingState(agent);
    const aisStatus = getAisStatus(agent);

    return (
        <div className="flex flex-col gap-4">
            {/* 헤더 */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{issueId}</p>
                    <h3 className="mt-1 text-lg font-semibold text-slate-100">{title}</h3>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${STATUS_COLORS[aisStatus]}`}>
                        {aisStatus}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${THINKING_STATE_COLORS[thinkingState] ?? ''}`}>
                        {thinkingState}
                    </span>
                </div>
            </div>

            {/* 메타 그리드 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                    { label: 'Agent', value: agent.agent_id },
                    { label: 'Status', value: agent.status },
                    { label: 'Last active', value: formatTs(agent.last_activity) },
                    { label: 'Session start', value: formatTs(agent.session_start) },
                ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
                        <p className="mt-1 break-all text-xs text-slate-200">{value}</p>
                    </div>
                ))}
            </div>

            {/* 현재 작업 */}
            {agent.status_detail && (
                <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Current task</p>
                    <p className="text-sm text-slate-300 leading-6">{agent.status_detail}</p>
                </div>
            )}
        </div>
    );
}

// ─── 로그 스트림 ───────────────────────────────────────────────────────────────

function LogStream({ agentId }: { agentId: string }) {
    const [snapshot, setSnapshot] = useState<AisLogSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const viewportRef = useRef<HTMLPreElement>(null);
    const POLL_MS = 2000;

    useEffect(() => {
        setSnapshot(null);
        setError(null);

        let cancelled = false;

        async function fetch_() {
            setRefreshing(true);
            try {
                const res = await fetch(`/api/v1/ais/sessions/${encodeURIComponent(agentId)}/log`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`${res.status}`);
                const data = await res.json() as AisLogSnapshot;
                if (!cancelled) { setSnapshot(data); setError(null); }
            } catch (e) {
                if (!cancelled) setError(`로그를 불러올 수 없습니다: ${String(e)}`);
            } finally {
                if (!cancelled) setRefreshing(false);
            }
        }

        void fetch_();
        const id = window.setInterval(() => void fetch_(), POLL_MS);
        return () => { cancelled = true; clearInterval(id); };
    }, [agentId]);

    // 새 로그 도착 시 스크롤 to bottom
    useEffect(() => {
        const el = viewportRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [snapshot?.lines.length]);

    return (
        <div className="flex flex-col rounded-xl border border-slate-700 bg-slate-950 overflow-hidden">
            {/* 헤더 */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-700/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${refreshing ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`} />
                    <span className="text-xs font-medium text-slate-400">agent.log</span>
                </div>
                <span className="text-[10px] text-slate-600">
                    {snapshot
                        ? `${snapshot.total_lines}줄${snapshot.truncated ? ' (끝 100줄)' : ''} · ${formatTs(snapshot.updated_at)}`
                        : '2초마다 갱신'}
                </span>
            </div>

            {/* 로그 뷰포트 */}
            <pre
                ref={viewportRef}
                className="h-72 overflow-auto px-4 py-3 font-mono text-xs leading-5 text-slate-300 whitespace-pre-wrap break-words"
            >
                {error ? (
                    <span className="text-orange-400">{error}</span>
                ) : snapshot ? (
                    snapshot.lines.length > 0
                        ? snapshot.lines.join('\n')
                        : <span className="text-slate-600">에이전트 출력 대기 중...</span>
                ) : (
                    <span className="text-slate-600">로그 불러오는 중...</span>
                )}
            </pre>
        </div>
    );
}

// ─── 메인 뷰 ──────────────────────────────────────────────────────────────────

export function AISWorktreeView() {
    const agents = useAgentStore((state) => state.agents);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // agent_id가 'ais-' 로 시작하는 에이전트만 필터
    const aisSessions: AgentLiveState[] = Object.values(agents)
        .filter((a) => a.agent_id.startsWith('ais-'))
        .sort((a, b) => b.last_activity.localeCompare(a.last_activity));

    // 자동 선택: 목록 변경 시 선택된 세션이 없거나 사라지면 첫 번째 선택
    useEffect(() => {
        if (aisSessions.length === 0) { setSelectedId(null); return; }
        if (!selectedId || !aisSessions.some((a) => a.agent_id === selectedId)) {
            setSelectedId(aisSessions[0]?.agent_id ?? null);
        }
    }, [aisSessions.map((a) => a.agent_id).join(',')]);

    const selectedAgent = aisSessions.find((a) => a.agent_id === selectedId) ?? null;

    return (
        <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)] xl:items-start">
            {/* 왼쪽: 세션 목록 */}
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-slate-100">Worktrees</h2>
                        <p className="text-xs text-slate-500 mt-0.5">/tmp/ais_workspaces</p>
                    </div>
                    <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                        {aisSessions.length}
                    </span>
                </div>

                {aisSessions.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        {aisSessions.map((agent) => (
                            <SessionCard
                                key={agent.agent_id}
                                agent={agent}
                                isSelected={agent.agent_id === selectedId}
                                onClick={() => setSelectedId(agent.agent_id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/40 px-4 py-8 text-center">
                        <p className="text-sm text-slate-500">실행 중인 워크트리가 없습니다.</p>
                        <p className="mt-1 text-xs text-slate-600">
                            AIS orchestrator가 <code className="text-slate-500">/tmp/ais_workspaces</code> 에 세션을 생성하면 여기에 표시됩니다.
                        </p>
                    </div>
                )}
            </div>

            {/* 오른쪽: 상세 + 로그 */}
            <div className="flex flex-col gap-4">
                {selectedAgent ? (
                    <>
                        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                            <SessionDetail agent={selectedAgent} />
                        </div>
                        <LogStream agentId={selectedAgent.agent_id} />
                    </>
                ) : (
                    <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-800/40">
                        <p className="text-sm text-slate-500">세션을 선택하세요.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
