import React from 'react';
import { StatusBar } from './StatusBar';
import { useSocket } from '../../hooks/useSocket';
import { AgentCardGrid } from './AgentCardGrid';
import { RelationshipGraph } from './RelationshipGraph';
import { MetricsPanel } from './MetricsPanel';
import { ActivityFeed } from './ActivityFeed';
import { TooltipProvider } from '../../components/ui/tooltip';

import { useAgentStore } from '../../stores/agentStore';
import { useMetricsStore } from '../../stores/metricsStore';

const USE_MOCK = import.meta.env?.VITE_MOCK === 'true';

export function DashboardView() {
    useSocket(); // Initialize WebSocket connection

    const { initSession, setConnectionStatus } = useAgentStore();
    const { setSnapshot } = useMetricsStore();

    // Mock 모드일 때만 가상 데이터 주입 (VITE_MOCK=true)
    React.useEffect(() => {
        if (!USE_MOCK) return;
        import('../../mock').then(({ generateMockAgents, generateMockMetrics }) => {
            setConnectionStatus(true);
            initSession(generateMockAgents());
            setSnapshot(generateMockMetrics());
        });
    }, [initSession, setConnectionStatus, setSnapshot]);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex flex-col h-full min-h-screen bg-slate-900 text-slate-50">

                {/* 1. Global Summarization Bar */}
                <StatusBar />

                {/* 2. Main Content Grid */}
                <div className="flex-1 p-4 flex flex-col xl:flex-row gap-4 overflow-hidden">

                    <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                        {/* Agent Cards Sub-Section */}
                        <div className="flex-[2] bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col min-h-[400px]">
                            <h2 className="text-lg font-semibold mb-4 shrink-0">Active Agents</h2>
                            <div className="flex-1 overflow-hidden min-h-0">
                                <AgentCardGrid />
                            </div>
                        </div>

                        {/* Relationship Graph Sub-Section (Desktop only) */}
                        <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 p-4 hidden lg:flex flex-col min-h-[250px]">
                            <h2 className="text-lg font-semibold mb-4 shrink-0">Agent Network <span className="text-sm font-normal text-slate-400">(Relationship Graph)</span></h2>
                            <div className="flex-1 overflow-hidden">
                                <RelationshipGraph />
                            </div>
                        </div>
                    </div>

                    {/* Metrics & Activity Section (Desktop right side) */}
                    <div className="flex-1 flex flex-col xl:flex-col lg:flex-row gap-4 xl:max-w-md w-full">

                        <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col overflow-hidden min-h-[350px]">
                            <h2 className="text-lg font-semibold mb-4 shrink-0">Metrics Panel</h2>
                            <div className="flex-1 overflow-hidden min-h-0">
                                <MetricsPanel />
                            </div>
                        </div>

                        <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col overflow-hidden min-h-[350px]">
                            <div className="flex justify-between items-center mb-2 shrink-0">
                                <h2 className="text-lg font-semibold">Activity Feed</h2>
                            </div>
                            <div className="flex-1 overflow-hidden min-h-0">
                                <ActivityFeed />
                            </div>
                        </div>

                    </div>

                </div>
            </div>
        </TooltipProvider>
    );
}
