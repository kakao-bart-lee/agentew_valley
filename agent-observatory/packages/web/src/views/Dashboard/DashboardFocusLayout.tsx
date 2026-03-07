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
    return (
        <div className="flex flex-col gap-6">
            <LiveMetricsOverview />

            <div className="grid gap-6 xl:grid-cols-[minmax(0,2.35fr)_minmax(21rem,0.95fr)] xl:items-start">
                <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
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
                    <AgentCardGrid
                        selectedAgentId={selectedAgentId}
                        onSelectAgent={onSelectAgent}
                        variant="run-groups"
                        groupingMode={groupingMode}
                    />
                </div>

                <div className="flex flex-col gap-4">
                    <FocusQueuePanel
                        selectedAgentId={selectedAgentId}
                        onSelectAgent={onSelectAgent}
                    />

                    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                        <h2 className="mb-2 text-lg font-semibold text-pretty">Activity Feed</h2>
                        <ActivityFeed />
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3">
                <h2 className="text-base font-semibold text-pretty">Detailed analytics</h2>
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
            </div>

            {focusPane === 'metrics' ? (
                <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                    <h2 className="mb-4 text-lg font-semibold text-pretty">Metrics Panel</h2>
                    <MetricsPanel />
                </div>
            ) : (
                <CostSummaryCard />
            )}
        </div>
    );
}
