import { useState, useEffect } from 'react';
import { TooltipProvider } from '../../components/ui/tooltip';
import { AgentDetailPanel } from './AgentDetailPanel';
import { DashboardClassicLayout } from './DashboardClassicLayout';
import { DashboardFocusLayout } from './DashboardFocusLayout';
import { DashboardLayoutToggle } from './DashboardLayoutToggle';

import { useAgentStore } from '../../stores/agentStore';
import { useMetricsStore } from '../../stores/metricsStore';
import {
    readDashboardFocusPane,
    readDashboardGroupingMode,
    readDashboardLayoutMode,
    writeDashboardFocusPane,
    writeDashboardGroupingMode,
    writeDashboardLayoutMode,
    type DashboardFocusPane,
    type DashboardGroupingMode,
    type DashboardLayoutMode,
} from '../../utils/dashboardLayout';

// 기본적으로 항상 실서버에 연결 (MOCK 명시적 true일때만 Mock 전환)
const USE_MOCK = import.meta.env?.VITE_MOCK === 'true';

export function DashboardView() {
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [layoutMode, setLayoutMode] = useState<DashboardLayoutMode>(() => readDashboardLayoutMode(window.location.search));
    const [focusPane, setFocusPane] = useState<DashboardFocusPane>(() => readDashboardFocusPane(window.location.search));
    const [groupingMode, setGroupingMode] = useState<DashboardGroupingMode>(() => readDashboardGroupingMode(window.location.search));

    const { initSession, setConnectionStatus, connected } = useAgentStore();
    const { setSnapshot } = useMetricsStore();

    // 임시: 서버 연동 전 UI 확인을 위해 기본적으로 Mock 데이터를 주입합니다. (VITE_MOCK=false일 때만 비활성화)
    useEffect(() => {
        if (!USE_MOCK) return;
        import('../../mock').then(({ generateMockAgents, generateMockMetrics }) => {
            setConnectionStatus(true);
            initSession(generateMockAgents());
            setSnapshot(generateMockMetrics());
        }).catch(err => console.error('Failed to load mock data:', err));
    }, [initSession, setConnectionStatus, setSnapshot]);

    useEffect(() => {
        const currentSearch = window.location.search;
        let nextSearch = writeDashboardLayoutMode(currentSearch, layoutMode);
        nextSearch = writeDashboardFocusPane(nextSearch, layoutMode === 'focus' ? focusPane : 'metrics');
        nextSearch = writeDashboardGroupingMode(nextSearch, layoutMode === 'focus' ? groupingMode : 'workstream');

        if (nextSearch === currentSearch) {
            return;
        }

        const url = new URL(window.location.href);
        url.search = nextSearch;
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }, [focusPane, groupingMode, layoutMode]);

    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex flex-1 min-h-0 flex-col bg-slate-900 text-slate-50">

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

                <div className="mx-auto flex w-full max-w-[1700px] flex-1 min-h-0 p-4 md:p-6">
                    <div className="flex flex-1 min-h-0 flex-col gap-6">
                        <DashboardLayoutToggle
                            value={layoutMode}
                            onChange={setLayoutMode}
                        />

                        {layoutMode === 'focus' ? (
                            <DashboardFocusLayout
                                selectedAgentId={selectedAgentId}
                                onSelectAgent={setSelectedAgentId}
                                focusPane={focusPane}
                                onFocusPaneChange={setFocusPane}
                                groupingMode={groupingMode}
                                onGroupingModeChange={setGroupingMode}
                            />
                        ) : (
                            <DashboardClassicLayout
                                selectedAgentId={selectedAgentId}
                                onSelectAgent={setSelectedAgentId}
                            />
                        )}
                    </div>
                </div>

                <AgentDetailPanel
                    agentId={selectedAgentId}
                    onClose={() => setSelectedAgentId(null)}
                />
            </div>
        </TooltipProvider>
    );
}
