import React, { useMemo, useState, useEffect } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { AgentCard } from './AgentCard';
import { SubAgentCard } from './SubAgentCard';
import { sortAgents } from '../../utils/sorting';
import { AgentCardFilters } from './AgentCardFilters';
import { AgentCardSkeleton } from '../../components/ui/skeleton';
import { AgentLiveState } from '../../types/agent';
import { Button } from '../../components/ui/button';
import {
    type AgentActivityScope,
    matchesAgentActivityScope,
} from '../../utils/agentActivity';
import type { DashboardGroupingMode } from '../../utils/dashboardLayout';

interface AgentCardGridProps {
    selectedAgentId?: string | null;
    onSelectAgent?: (id: string) => void;
    variant?: 'grouped' | 'dense' | 'grouped-dense' | 'run-groups';
    groupingMode?: DashboardGroupingMode;
}

/**
 * project_id를 사람이 읽기 좋은 표시 이름으로 변환한다.
 *
 * Claude Code: "-Users-joy-workspace-my-repo" → "my-repo"
 *   (슬래시를 대시로 치환한 경로 → 마지막 세그먼트)
 * OpenClaw:   "/Users/joy/workspace/my-repo" → "my-repo"
 *   (실제 절대 경로 → basename)
 */
const GENERIC_PROJECT_SEGMENTS = new Set([
    'users',
    'user',
    'workspace',
    'workspaces',
    'repo',
    'repos',
    'project',
    'projects',
    'builds',
]);

function projectDisplayName(projectId: string): string {
    if (projectId.startsWith('/')) {
        // OpenClaw: 실제 절대 경로
        const segments = projectId.split('/').filter(Boolean);
        const last = segments[segments.length - 1] ?? projectId;
        const prev = segments[segments.length - 2];
        const normalizedLast = last.replace(/_/g, '-');

        if (GENERIC_PROJECT_SEGMENTS.has(normalizedLast.toLowerCase()) && prev) {
            return prev.replace(/_/g, '-');
        }

        return normalizedLast;
    }

    // Claude Code: 대시 인코딩된 경로 → 의미 있는 끝 1~2개 세그먼트
    const segments = projectId.split('-').filter(Boolean);
    if (segments.length === 0) {
        return projectId;
    }

    const last = segments[segments.length - 1]?.toLowerCase();
    const prev = segments[segments.length - 2]?.toLowerCase();

    if (!last) {
        return projectId;
    }

    if (prev && !GENERIC_PROJECT_SEGMENTS.has(prev)) {
        return `${prev}-${last}`;
    }

    return last;
}

export function AgentCardGrid({
    selectedAgentId,
    onSelectAgent,
    variant = 'grouped',
    groupingMode = 'workstream',
}: AgentCardGridProps) {
    const { agents, sourceFilter, statusFilter, connected } = useAgentStore();
    const [hasReceivedData, setHasReceivedData] = useState(agents.size > 0);
    useEffect(() => {
        if (agents.size > 0) setHasReceivedData(true);
    }, [agents.size]);
    const [sortMode, setSortMode] = useState<'status' | 'name' | 'activity' | 'cost'>('status');
    const [activityScope, setActivityScope] = useState<AgentActivityScope>('live');
    const [activityNow, setActivityNow] = useState(() => Date.now());

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setActivityNow(Date.now());
        }, 30_000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    const filteredAgents = useMemo(() => {
        let list = Array.from(agents.values());
        if (sourceFilter.length > 0) list = list.filter(a => sourceFilter.includes(a.source));
        if (statusFilter.length > 0) list = list.filter(a => statusFilter.includes(a.status));
        return list;
    }, [agents, sourceFilter, statusFilter]);

    const scopedAgents = useMemo(() => (
        filteredAgents.filter((agent) => (
            agent.agent_id === selectedAgentId ||
            matchesAgentActivityScope(agent, activityScope, activityNow)
        ))
    ), [activityNow, activityScope, filteredAgents, selectedAgentId]);

    const visibleAgentIds = useMemo(() => new Set(scopedAgents.map((agent) => agent.agent_id)), [scopedAgents]);
    const sortedVisibleAgents = useMemo(() => sortAgents(scopedAgents, sortMode), [scopedAgents, sortMode]);

    // 부모 ID → 자식 에이전트 목록 맵 (activity scope 적용)
    const childrenMap = useMemo(() => {
        const map = new Map<string, AgentLiveState[]>();
        scopedAgents.forEach(a => {
            if (a.parent_agent_id) {
                if (!map.has(a.parent_agent_id)) map.set(a.parent_agent_id, []);
                map.get(a.parent_agent_id)!.push(a);
            }
        });
        return map;
    }, [scopedAgents]);

    // 루트 에이전트(parent 없음)만 추출 후 정렬
    const rootAgents = useMemo(() => {
        const roots = filteredAgents.filter(a => (
            !a.parent_agent_id &&
            (visibleAgentIds.has(a.agent_id) || (childrenMap.get(a.agent_id)?.length ?? 0) > 0)
        ));
        return sortAgents(roots, sortMode);
    }, [childrenMap, filteredAgents, sortMode, visibleAgentIds]);

    // project_id 기준으로 루트 에이전트 그루핑
    const projectGroups = useMemo(() => {
        const map = new Map<string, { label: string; agents: AgentLiveState[] }>();
        rootAgents.forEach(agent => {
            const label = agent.project_id ? projectDisplayName(agent.project_id) : 'unknown-project';
            const key = label.toLowerCase();

            if (!map.has(key)) {
                map.set(key, { label, agents: [] });
            }

            map.get(key)!.agents.push(agent);
        });
        return Array.from(map.values()).sort((a, b) => {
            if (a.label === 'unknown-project') return 1;
            if (b.label === 'unknown-project') return -1;
            return a.label.localeCompare(b.label);
        });
    }, [rootAgents]);

    const runGroups = useMemo(() => {
        const map = new Map<string, { key: string; label: string; roots: AgentLiveState[] }>();

        rootAgents.forEach((agent) => {
            const projectLabel = agent.project_id ? projectDisplayName(agent.project_id) : undefined;
            const groupKey = agent.team_id
                ? `team:${agent.team_id}`
                : agent.task_context?.issue_identifier
                    ? `issue:${agent.task_context.issue_identifier}`
                    : projectLabel
                        ? `project:${projectLabel.toLowerCase()}`
                        : `agent:${agent.agent_id}`;

            const label = agent.task_context?.title
                ?? agent.task_context?.issue_identifier
                ?? agent.team_id
                ?? projectLabel
                ?? agent.runtime?.family
                ?? agent.source;

            if (!map.has(groupKey)) {
                map.set(groupKey, { key: groupKey, label, roots: [] });
            }

            map.get(groupKey)!.roots.push(agent);
        });

        const allGroups = Array.from(map.values()).map((group) => ({
            ...group,
            childCount: group.roots.reduce((sum, root) => sum + (childrenMap.get(root.agent_id)?.length ?? 0), 0),
        }));

        const coordinated = allGroups
            .filter((group) => group.roots.length > 1 || group.childCount > 0)
            .sort((a, b) => {
                if (b.roots.length !== a.roots.length) return b.roots.length - a.roots.length;
                if (b.childCount !== a.childCount) return b.childCount - a.childCount;
                return a.label.localeCompare(b.label);
            });

        const coordinatedRootIds = new Set(
            coordinated.flatMap((group) => group.roots.map((root) => root.agent_id)),
        );

        const solo = rootAgents.filter((agent) => !coordinatedRootIds.has(agent.agent_id));

        return { coordinated, solo };
    }, [childrenMap, rootAgents]);

    const explicitGroups = useMemo(() => {
        const map = new Map<string, { key: string; label: string; roots: AgentLiveState[]; childCount: number }>();

        rootAgents.forEach((agent) => {
            const runtimeLabel = agent.runtime?.family ?? agent.source;
            const groupKey = groupingMode === 'repo'
                ? `repo:${agent.project_id ? projectDisplayName(agent.project_id).toLowerCase() : 'unknown'}`
                : groupingMode === 'runtime'
                    ? `runtime:${runtimeLabel}`
                    : `team:${agent.team_id ?? 'no-team'}`;
            const label = groupingMode === 'repo'
                ? (agent.project_id ? projectDisplayName(agent.project_id) : 'Unknown project')
                : groupingMode === 'runtime'
                    ? runtimeLabel
                    : (agent.team_id ?? 'No team');

            if (!map.has(groupKey)) {
                map.set(groupKey, { key: groupKey, label, roots: [], childCount: 0 });
            }

            const group = map.get(groupKey)!;
            group.roots.push(agent);
            group.childCount += childrenMap.get(agent.agent_id)?.length ?? 0;
        });

        return Array.from(map.values()).sort((a, b) => {
            if (b.roots.length !== a.roots.length) return b.roots.length - a.roots.length;
            if (b.childCount !== a.childCount) return b.childCount - a.childCount;
            return a.label.localeCompare(b.label);
        });
    }, [childrenMap, groupingMode, rootAgents]);

    const hiddenAgentCount = Math.max(filteredAgents.length - scopedAgents.length, 0);
    const liveAgentCount = useMemo(
        () => filteredAgents.filter((agent) => matchesAgentActivityScope(agent, 'live', activityNow)).length,
        [activityNow, filteredAgents],
    );
    const recentAgentCount = useMemo(
        () => filteredAgents.filter((agent) => matchesAgentActivityScope(agent, 'recent', activityNow)).length,
        [activityNow, filteredAgents],
    );

    const emptyMessage = activityScope === 'live'
        ? 'No agents are active right now.'
        : activityScope === 'recent'
            ? 'No recent agents match the current filters.'
            : 'No agents match the current filters.';
    const emptyHint = activityScope === 'all'
        ? 'Try changing the source/status filters.'
        : 'Switch to a wider activity window to inspect older sessions.';

    const renderDenseGrid = () => (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {sortedVisibleAgents.map((agent) => (
                <div key={agent.agent_id} className="min-w-0">
                    {agent.parent_agent_id ? (
                        <SubAgentCard
                            agent={agent}
                            isSelected={agent.agent_id === selectedAgentId}
                            onClick={() => onSelectAgent?.(agent.agent_id)}
                        />
                    ) : (
                        <AgentCard
                            agent={agent}
                            isSelected={agent.agent_id === selectedAgentId}
                            onClick={() => onSelectAgent?.(agent.agent_id)}
                        />
                    )}
                </div>
            ))}
        </div>
    );

    const renderGroupedFamilies = (agentList: AgentLiveState[], denseFamilies: boolean) => (
        <div className={`grid gap-4 ${denseFamilies ? 'xl:grid-cols-2' : ''}`}>
            {agentList.map((agent) => {
                const children = childrenMap.get(agent.agent_id) ?? [];

                return (
                    <div key={agent.agent_id} className="min-w-0 rounded-xl border border-slate-700/50 bg-slate-900/20 p-2.5">
                        <AgentCard
                            agent={agent}
                            isSelected={agent.agent_id === selectedAgentId}
                            onClick={() => onSelectAgent?.(agent.agent_id)}
                        />

                        {children.length > 0 && (
                            <div className="mt-3 space-y-2 border-l border-violet-500/20 pl-3">
                                {children.map((child) => (
                                    <SubAgentCard
                                        key={child.agent_id}
                                        agent={child}
                                        isSelected={child.agent_id === selectedAgentId}
                                        onClick={() => onSelectAgent?.(child.agent_id)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );

    const renderWorkstreamGroups = () => (
        <div className="flex flex-col gap-8">
            {runGroups.coordinated.length > 0 && (
                <section className="flex flex-col gap-4">
                    <div className="flex items-end justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-200">Delegated work</h3>
                            <p className="mt-1 text-xs text-slate-500">
                                Parent/child runs and multi-agent workstreams stay together first.
                            </p>
                        </div>
                        <span className="text-[11px] text-slate-500">
                            {runGroups.coordinated.length} grouped run{runGroups.coordinated.length === 1 ? '' : 's'}
                        </span>
                    </div>

                    <div className="flex flex-col gap-4">
                        {runGroups.coordinated.map((group) => (
                            <div key={group.key} className="rounded-xl border border-slate-700/60 bg-slate-900/20 p-3">
                                <div className="mb-3 flex items-center gap-2">
                                    <span className="rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-1 text-xs font-medium text-slate-200">
                                        {group.label}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                        {group.roots.length} root · {group.childCount} child
                                    </span>
                                </div>
                                {renderGroupedFamilies(group.roots, true)}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {runGroups.solo.length > 0 && (
                <section className="flex flex-col gap-4">
                    <div className="flex items-end justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-200">Independent runs</h3>
                            <p className="mt-1 text-xs text-slate-500">
                                Independent runs grouped in a compact board, with repo context kept on each tile.
                            </p>
                        </div>
                        <span className="text-[11px] text-slate-500">
                            {runGroups.solo.length} solo agent{runGroups.solo.length === 1 ? '' : 's'}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        {runGroups.solo.map((agent) => (
                            <div key={agent.agent_id} className="rounded-xl border border-slate-700/50 bg-slate-900/20 p-2.5">
                                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                                    <span
                                        className="truncate rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-300"
                                        title={agent.project_id}
                                    >
                                        {agent.project_id ? projectDisplayName(agent.project_id) : 'Unknown project'}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                        {agent.runtime?.family ?? agent.source}
                                    </span>
                                </div>
                                <AgentCard
                                    agent={agent}
                                    isSelected={agent.agent_id === selectedAgentId}
                                    onClick={() => onSelectAgent?.(agent.agent_id)}
                                />
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );

    const renderExplicitGroups = () => (
        <div className="flex flex-col gap-6">
            {explicitGroups.map((group) => (
                <section key={group.key} className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                        <span className="rounded-md border border-slate-700/70 bg-slate-800/70 px-2 py-1 text-xs font-medium text-slate-200">
                            {group.label}
                        </span>
                        <div className="h-px flex-1 bg-slate-700/40" />
                        <span className="text-[11px] text-slate-500">
                            {group.roots.length} root · {group.childCount} child
                        </span>
                    </div>
                    {renderGroupedFamilies(group.roots, true)}
                </section>
            ))}
        </div>
    );

    // Skeleton: connected but no data yet
    if (connected && !hasReceivedData) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => <AgentCardSkeleton key={i} />)}
            </div>
        );
    }

    if (agents.size === 0) {
        return (
                <div className="flex flex-col items-center justify-center p-12 text-slate-500 h-64 border border-dashed border-slate-700 rounded-lg">
                <p>No observed agents detected.</p>
                <p className="text-sm">Watching connected directories and backfill sources...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <div className="flex flex-col gap-3">
                    <AgentCardFilters />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-400 mr-2">Window:</span>
                        <div className="flex bg-slate-900/50 p-1 rounded-md border border-slate-700/50 overflow-hidden">
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 px-2 text-xs whitespace-nowrap ${activityScope === 'live' ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`}
                                onClick={() => setActivityScope('live')}
                            >
                                Live now ({liveAgentCount})
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 px-2 text-xs whitespace-nowrap ${activityScope === 'recent' ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`}
                                onClick={() => setActivityScope('recent')}
                            >
                                Recent 24h ({recentAgentCount})
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 px-2 text-xs whitespace-nowrap ${activityScope === 'all' ? 'bg-slate-700 text-slate-200' : 'text-slate-400'}`}
                                onClick={() => setActivityScope('all')}
                            >
                                All loaded ({filteredAgents.length})
                            </Button>
                        </div>
                        {activityScope !== 'all' && hiddenAgentCount > 0 && (
                            <span className="text-slate-500">
                                Hiding {hiddenAgentCount} dormant/backfilled agent{hiddenAgentCount > 1 ? 's' : ''}.
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4 bg-slate-900/50 p-1.5 rounded-md border border-slate-700/50 shrink-0">
                    <div className="flex items-center space-x-2 px-2">
                        <label className="text-xs text-slate-400">Sort by:</label>
                        <select
                            value={sortMode}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortMode(e.target.value as typeof sortMode)}
                            className="bg-slate-800 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-slate-500 cursor-pointer"
                        >
                            <option value="status">Status</option>
                            <option value="name">Name</option>
                            <option value="activity">Activity</option>
                            <option value="cost">Cost</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="overflow-y-auto pb-4 custom-scrollbar">
                {variant === 'dense' ? (
                    sortedVisibleAgents.length === 0 ? (
                        <div className="text-center p-8 text-slate-500">
                            <div>{emptyMessage}</div>
                            <div className="mt-1 text-xs text-slate-600">{emptyHint}</div>
                        </div>
                    ) : (
                        renderDenseGrid()
                    )
                ) : variant === 'run-groups' ? (
                    rootAgents.length === 0 ? (
                        <div className="text-center p-8 text-slate-500">
                            <div>{emptyMessage}</div>
                            <div className="mt-1 text-xs text-slate-600">{emptyHint}</div>
                        </div>
                    ) : (
                        groupingMode === 'workstream' ? renderWorkstreamGroups() : renderExplicitGroups()
                    )
                ) : rootAgents.length === 0 ? (
                    <div className="text-center p-8 text-slate-500">
                        <div>{emptyMessage}</div>
                        <div className="mt-1 text-xs text-slate-600">{emptyHint}</div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-8">
                        {projectGroups.map((group) => (
                            <div key={group.label} className="flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-slate-400 bg-slate-800/60 border border-slate-700/60 rounded px-2 py-0.5">
                                        📁 {group.label === 'unknown-project' ? 'Unknown project' : group.label}
                                    </span>
                                    <div className="flex-1 h-px bg-slate-700/40" />
                                    <span className="text-[11px] text-slate-500">{group.agents.length} agent{group.agents.length > 1 ? 's' : ''}</span>
                                </div>
                                {renderGroupedFamilies(group.agents, variant === 'grouped-dense')}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
