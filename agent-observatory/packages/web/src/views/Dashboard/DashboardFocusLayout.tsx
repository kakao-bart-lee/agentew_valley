import { useState } from 'react';
import type { DashboardFocusPane, DashboardGroupingMode } from '../../utils/dashboardLayout';
import { AgentCardGrid } from './AgentCardGrid';
import { ActivityFeed } from './ActivityFeed';
import { MetricsPanel } from './MetricsPanel';
import { CostSummaryCard } from './CostSummaryCard';
import { FocusQueuePanel } from './FocusQueuePanel';
import { LiveMetricsOverview } from './LiveMetricsOverview';

interface DashboardFocusLayoutProps {
    selectedAgentId: string | null;
    onSelectAgent: (agentId: string) => void;
    focusPane: DashboardFocusPane;
    onFocusPaneChange: (pane: DashboardFocusPane) => void;
    groupingMode: DashboardGroupingMode;
    onGroupingModeChange: (mode: DashboardGroupingMode) => void;
}

const GROUPING_OPTIONS: Array<{ id: DashboardGroupingMode; label: string }> = [
    { id: 'workstream', label: 'Workstream' },
    { id: 'repo', label: 'Repo' },
    { id: 'runtime', label: 'Runtime' },
    { id: 'team', label: 'Team' },
];

export function DashboardFocusLayout({
    selectedAgentId,
    onSelectAgent,
    focusPane,
    onFocusPaneChange,
    groupingMode,
    onGroupingModeChange,
}: DashboardFocusLayoutProps) {
    const [detailsOpen, setDetailsOpen] = useState(false);

    return (
        <div className="flex flex-col gap-6">
            <LiveMetricsOverview />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,2.35fr)_minmax(21rem,0.95fr)]">
                <div className="flex min-h-[560px] flex-col rounded-xl border border-slate-700 bg-slate-800 p-4 xl:h-[42rem]">
                    <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div>
                            <h2 className="shrink-0 text-lg font-semibold text-pretty">
                                Observed Agents <span className="text-sm font-normal text-slate-400">(focus layout)</span>
                            </h2>
                            <p className="mt-2 shrink-0 text-sm text-slate-400">
                                Switch grouping between delegated work, repositories, runtimes, and teams without losing the live context.
                            </p>
                        </div>

                        <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/70 p-1">
                            <span className="px-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">Group by</span>
                            {GROUPING_OPTIONS.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => onGroupingModeChange(option.id)}
                                    aria-pressed={groupingMode === option.id}
                                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                        groupingMode === option.id
                                            ? 'bg-indigo-600 text-white'
                                            : 'text-slate-400 hover:bg-slate-700/80 hover:text-slate-100'
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <AgentCardGrid
                            selectedAgentId={selectedAgentId}
                            onSelectAgent={onSelectAgent}
                            variant="run-groups"
                            groupingMode={groupingMode}
                        />
                    </div>
                </div>

                <div className="flex min-h-[420px] flex-col gap-4 xl:h-[42rem]">
                    <div className="min-h-[220px] flex-[2] xl:min-h-0">
                        <FocusQueuePanel
                            selectedAgentId={selectedAgentId}
                            onSelectAgent={onSelectAgent}
                        />
                    </div>

                    <div className="flex min-h-[280px] flex-[3] flex-col rounded-xl border border-slate-700 bg-slate-800 p-4 xl:min-h-0">
                        <div className="mb-2 flex items-center justify-between shrink-0">
                            <h2 className="text-lg font-semibold text-pretty">Activity Feed</h2>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <ActivityFeed />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3">
                <div>
                    <h2 className="text-base font-semibold text-pretty">Detailed analytics</h2>
                    <p className="mt-1 text-sm text-slate-400">
                        Hidden by default so the live board stays readable. Expand only when you want deeper charts or spend detail.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {detailsOpen && (
                        <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-800/70 p-1">
                            <button
                                type="button"
                                onClick={() => onFocusPaneChange('metrics')}
                                aria-pressed={focusPane === 'metrics'}
                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                    focusPane === 'metrics'
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-400 hover:bg-slate-700/80 hover:text-slate-100'
                                }`}
                            >
                                Metrics
                            </button>
                            <button
                                type="button"
                                onClick={() => onFocusPaneChange('cost')}
                                aria-pressed={focusPane === 'cost'}
                                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                                    focusPane === 'cost'
                                        ? 'bg-indigo-600 text-white'
                                        : 'text-slate-400 hover:bg-slate-700/80 hover:text-slate-100'
                                }`}
                            >
                                Cost
                            </button>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => setDetailsOpen((open) => !open)}
                        className="rounded-md border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-900"
                    >
                        {detailsOpen ? 'Hide details' : 'Show details'}
                    </button>
                </div>
            </div>

            {detailsOpen && (
                focusPane === 'metrics' ? (
                    <div className="flex min-h-[28rem] flex-col rounded-xl border border-slate-700 bg-slate-800 p-4 xl:h-[32rem]">
                        <h2 className="mb-4 shrink-0 text-lg font-semibold text-pretty">Metrics Panel</h2>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <MetricsPanel />
                        </div>
                    </div>
                ) : (
                    <CostSummaryCard />
                )
            )}
        </div>
    );
}
