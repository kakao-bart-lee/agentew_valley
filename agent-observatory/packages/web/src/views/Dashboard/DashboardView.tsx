import { useState, useEffect } from 'react';
import { AgentCardGrid } from './AgentCardGrid';
import { RelationshipGraph } from './RelationshipGraph';
import { MetricsPanel } from './MetricsPanel';
import { ActivityFeed } from './ActivityFeed';
import { TooltipProvider } from '../../components/ui/tooltip';
import { AgentDetailPanel } from './AgentDetailPanel';
import { MissionControlSummarySection } from './MissionControlSummarySection';
import { CostSummaryCard } from './CostSummaryCard';
import { GoalProgressCard } from './GoalProgressCard';

import { useAgentStore } from '../../stores/agentStore';
import { useMetricsStore } from '../../stores/metricsStore';

// 기본적으로 항상 실서버에 연결 (MOCK 명시적 true일때만 Mock 전환)
const USE_MOCK = import.meta.env?.VITE_MOCK === 'true';

export function DashboardView() {
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

    const { initSession, setConnectionStatus, connected } = useAgentStore();
    const { setSnapshot } = useMetricsStore();

    // 임시: 서버 연동 전 UI 확인을 위해 기본적으로 Mock 데이터를 주입합니다. (VITE_MOCK=false일 때만 비활성화)
    useEffect(() => {
        if (!USE_MOCK) return;
        import('../../mock').then(({ generateMockAgents, generateMockMetrics }) => {
            setConnectionStatus(true);
            initSession(generateMockAgents());
            setSnapshot(generateMockMetrics());
        }).catch(err => console.error("Failed to load mock data:", err));
    }, [initSession, setConnectionStatus, setSnapshot]);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex flex-col min-h-screen bg-slate-900 text-slate-50">

                {/* Offline Overlay */}
                {!connected && (
                    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center">
                        <div className="bg-slate-900 border border-slate-700 p-8 rounded-xl shadow-2xl max-w-md w-full flex flex-col items-center">
                            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold text-white mb-2">Connection Lost</h2>
                            <p className="text-slate-400 mb-6 text-sm">Attempting to reconnect...</p>
                            <div className="flex gap-2 w-full justify-center opacity-50">
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 1. Global Summarization Bar was moved to App.tsx */}

                {/* 2. Main Content Grid */}
                <div className="flex-1 p-4 md:p-6 mx-auto w-full max-w-[1500px]">
                    <div className="flex flex-col gap-6">
                        <div className="flex flex-col xl:flex-row gap-6">

                            {/* Left/Main Column */}
                            <div className="flex-[2] flex flex-col gap-6">
                                {/* Agent Cards Sub-Section */}
                                <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col min-h-[500px]">
                                    <h2 className="text-lg font-semibold mb-4 shrink-0">Active Agents</h2>
                                    <div className="flex-1 overflow-hidden min-h-0">
                                        <AgentCardGrid
                                            selectedAgentId={selectedAgentId}
                                            onSelectAgent={setSelectedAgentId}
                                        />
                                    </div>
                                </div>

                                {/* Relationship Graph Sub-Section (Desktop only) */}
                                <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 p-4 hidden lg:flex flex-col min-h-[250px]">
                                    <h2 className="text-lg font-semibold mb-4 shrink-0">Agent Network <span className="text-sm font-normal text-slate-400">(Relationship Graph)</span></h2>
                                    <div className="flex-1 overflow-hidden">
                                        <RelationshipGraph
                                            selectedAgentId={selectedAgentId}
                                            onSelectAgent={setSelectedAgentId}
                                        />
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

                        <div className="grid gap-6 xl:grid-cols-2">
                            <CostSummaryCard />
                            <GoalProgressCard />
                        </div>

                        <MissionControlSummarySection />
                    </div>
                </div>

                {/* Sliding Overlay Panel for Agent Details */}
                <AgentDetailPanel
                    agentId={selectedAgentId}
                    onClose={() => setSelectedAgentId(null)}
                />
            </div>
        </TooltipProvider>
    );
}
