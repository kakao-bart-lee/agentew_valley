import React, { useMemo, useState, useEffect } from 'react';
import { useAgentStore } from '../../stores/agentStore';
import { AgentCard } from './AgentCard';
import { SubAgentCard } from './SubAgentCard';
import { sortAgents } from '../../utils/sorting';
import { AgentCardFilters } from './AgentCardFilters';
import { AgentCardSkeleton } from '../../components/ui/skeleton';
import { AgentLiveState } from '../../types/agent';

interface AgentCardGridProps {
    selectedAgentId?: string | null;
    onSelectAgent?: (id: string) => void;
}

/**
 * project_id를 사람이 읽기 좋은 표시 이름으로 변환한다.
 *
 * Claude Code: "-Users-joy-workspace-my-repo" → "my-repo"
 *   (슬래시를 대시로 치환한 경로 → 마지막 세그먼트)
 * OpenClaw:   "/Users/joy/workspace/my-repo" → "my-repo"
 *   (실제 절대 경로 → basename)
 */
function projectDisplayName(projectId: string): string {
    if (projectId.startsWith('/')) {
        // OpenClaw: 실제 절대 경로
        return projectId.split('/').filter(Boolean).pop() ?? projectId;
    }
    // Claude Code: 대시 인코딩된 경로 → 마지막 세그먼트
    const segments = projectId.split('-').filter(Boolean);
    return segments.pop() ?? projectId;
}

export function AgentCardGrid({ selectedAgentId, onSelectAgent }: AgentCardGridProps) {
    const { agents, sourceFilter, statusFilter, connected } = useAgentStore();
    const [hasReceivedData, setHasReceivedData] = useState(agents.size > 0);
    useEffect(() => {
        if (agents.size > 0) setHasReceivedData(true);
    }, [agents.size]);
    const [sortMode, setSortMode] = useState<'status' | 'name' | 'activity' | 'cost'>('status');

    const filteredAgents = useMemo(() => {
        let list = Array.from(agents.values());
        if (sourceFilter.length > 0) list = list.filter(a => sourceFilter.includes(a.source));
        if (statusFilter.length > 0) list = list.filter(a => statusFilter.includes(a.status));
        return list;
    }, [agents, sourceFilter, statusFilter]);

    // 부모 ID → 자식 에이전트 목록 맵 (필터 미적용 — 자식은 항상 표시)
    const childrenMap = useMemo(() => {
        const map = new Map<string, AgentLiveState[]>();
        Array.from(agents.values()).forEach(a => {
            if (a.parent_agent_id) {
                if (!map.has(a.parent_agent_id)) map.set(a.parent_agent_id, []);
                map.get(a.parent_agent_id)!.push(a);
            }
        });
        return map;
    }, [agents]);

    // 루트 에이전트(parent 없음)만 추출 후 정렬
    const rootAgents = useMemo(() => {
        const roots = filteredAgents.filter(a => !a.parent_agent_id);
        return sortAgents(roots, sortMode);
    }, [filteredAgents, sortMode]);

    // project_id 기준으로 루트 에이전트 그루핑
    const projectGroups = useMemo(() => {
        const map = new Map<string, AgentLiveState[]>();
        rootAgents.forEach(agent => {
            const key = agent.project_id ?? '__none__';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(agent);
        });
        // project 있는 그룹 먼저, 없는 그룹('__none__') 마지막
        return Array.from(map.entries()).sort(([a], [b]) => {
            if (a === '__none__') return 1;
            if (b === '__none__') return -1;
            return a.localeCompare(b);
        });
    }, [rootAgents]);

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

    const renderAgentGroup = (agentList: AgentLiveState[]) => (
        <div className="flex flex-col gap-3">
            {agentList.map(agent => {
                const children = childrenMap.get(agent.agent_id) ?? [];
                return (
                    <div key={agent.agent_id} className="flex flex-wrap items-start gap-2">
                        {/* 루트 에이전트 카드 */}
                        <div className="w-72 shrink-0">
                            <AgentCard
                                agent={agent}
                                isSelected={agent.agent_id === selectedAgentId}
                                onClick={() => onSelectAgent?.(agent.agent_id)}
                            />
                        </div>

                        {/* 서브에이전트 — 루트와 같은 줄에 가로 배치 */}
                        {children.map(child => (
                            <div key={child.agent_id} className="w-72 shrink-0">
                                <SubAgentCard
                                    agent={child}
                                    isSelected={child.agent_id === selectedAgentId}
                                    onClick={() => onSelectAgent?.(child.agent_id)}
                                />
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <AgentCardFilters />

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
                {rootAgents.length === 0 ? (
                    <div className="text-center p-8 text-slate-500">No agents match the current filters.</div>
                ) : projectGroups.length === 1 && projectGroups[0][0] === '__none__' ? (
                    /* project_id 없는 에이전트만 있을 때 — 그루핑 헤더 없이 표시 */
                    renderAgentGroup(projectGroups[0][1])
                ) : (
                    /* project 기준 그루핑 */
                    <div className="flex flex-col gap-8">
                        {projectGroups.map(([projectId, projectAgents]) => (
                            <div key={projectId} className="flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono text-slate-400 bg-slate-800/60 border border-slate-700/60 rounded px-2 py-0.5"
                                        title={projectId !== '__none__' ? projectId : undefined}>
                                        {projectId !== '__none__'
                                            ? `📁 ${projectDisplayName(projectId)}`
                                            : '📁 Unknown project'}
                                    </span>
                                    <div className="flex-1 h-px bg-slate-700/40" />
                                    <span className="text-[11px] text-slate-500">{projectAgents.length} agent{projectAgents.length > 1 ? 's' : ''}</span>
                                </div>
                                {renderAgentGroup(projectAgents)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
