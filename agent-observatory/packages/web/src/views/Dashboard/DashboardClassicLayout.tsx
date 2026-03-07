import { AgentCardGrid } from './AgentCardGrid';
import { MetricsPanel } from './MetricsPanel';
import { ActivityFeed } from './ActivityFeed';
import { CostSummaryCard } from './CostSummaryCard';
import { ServicesWidget } from './ServicesWidget';

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
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(24rem,1.1fr)] xl:items-start">
                {/* Left: Observed Agents — grows with content */}
                <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                    <h2 className="mb-4 text-lg font-semibold text-pretty">
                        Observed Agents <span className="text-sm font-normal text-slate-400">(live + recent + backfilled)</span>
                    </h2>
                    <AgentCardGrid
                        selectedAgentId={selectedAgentId}
                        onSelectAgent={onSelectAgent}
                        variant="grouped"
                    />
                </div>

                {/* Right column: stacks vertically, grows freely */}
                <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                        <h2 className="mb-4 text-lg font-semibold text-pretty">Metrics Panel</h2>
                        <MetricsPanel />
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                        <h2 className="mb-2 text-lg font-semibold text-pretty">Activity Feed</h2>
                        <ActivityFeed />
                    </div>

                    <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
                        <h2 className="mb-3 text-lg font-semibold text-pretty">PM2 Services</h2>
                        <ServicesWidget />
                    </div>
                </div>
            </div>

            <CostSummaryCard />
        </div>
    );
}
