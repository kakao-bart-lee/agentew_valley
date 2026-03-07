import { AgentCardGrid } from './AgentCardGrid';
import { MetricsPanel } from './MetricsPanel';
import { ActivityFeed } from './ActivityFeed';
import { CostSummaryCard } from './CostSummaryCard';

interface DashboardClassicLayoutProps {
    selectedAgentId: string | null;
    onSelectAgent: (agentId: string) => void;
}

export function DashboardClassicLayout({
    selectedAgentId,
    onSelectAgent,
}: DashboardClassicLayoutProps) {
    return (
        <div className="flex flex-col gap-6">
            <div className="grid flex-1 min-h-0 gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(24rem,1.1fr)]">
                <div className="flex min-h-0 flex-[2] flex-col gap-6 xl:h-[44rem]">
                    <div className="flex min-h-[500px] flex-1 flex-col rounded-xl border border-slate-700 bg-slate-800 p-4 xl:min-h-0">
                        <h2 className="mb-4 shrink-0 text-lg font-semibold text-pretty">
                            Observed Agents <span className="text-sm font-normal text-slate-400">(live + recent + backfilled)</span>
                        </h2>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <AgentCardGrid
                                selectedAgentId={selectedAgentId}
                                onSelectAgent={onSelectAgent}
                                variant="grouped"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex min-h-0 w-full flex-1 flex-col gap-4 xl:h-[44rem] xl:flex-col">
                    <div className="flex min-h-[350px] flex-[3] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-800 p-4 xl:min-h-0">
                        <h2 className="mb-4 shrink-0 text-lg font-semibold text-pretty">Metrics Panel</h2>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <MetricsPanel />
                        </div>
                    </div>

                    <div className="flex min-h-[280px] flex-[2] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-800 p-4 xl:min-h-0">
                        <div className="mb-2 flex items-center justify-between shrink-0">
                            <h2 className="text-lg font-semibold text-pretty">Activity Feed</h2>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                            <ActivityFeed />
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid shrink-0 gap-6">
                <CostSummaryCard />
            </div>
        </div>
    );
}
