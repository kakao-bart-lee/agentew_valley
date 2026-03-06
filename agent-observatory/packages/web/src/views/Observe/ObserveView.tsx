import { useEffect, useState } from 'react';
import { DashboardView } from '../Dashboard/DashboardView';
import { SessionsView } from '../Sessions/SessionsView';
import { PixelCanvasView } from '../Pixel/PixelCanvasView';
import { useSocket } from '../../hooks/useSocket';
import { useAgentStore } from '../../stores/agentStore';

const OBSERVE_TABS = [
  { id: 'live', label: 'Live', description: 'Real-time agent state, metrics, and raw activity.' },
  { id: 'sessions', label: 'Sessions', description: 'Replay and analyze recorded runs.' },
  { id: 'pixel', label: 'Pixel', description: 'Specialized live visualization for the same system.' },
] as const;

type ObserveTab = typeof OBSERVE_TABS[number]['id'];

export function ObserveView() {
  const [activeTab, setActiveTab] = useState<ObserveTab>('live');
  const { setView: setSocketView } = useSocket();
  const activeView = useAgentStore((state) => state.activeView);
  const connected = useAgentStore((state) => state.connected);

  useEffect(() => {
    if (!connected || activeView !== 'observe') {
      return;
    }
    setSocketView(activeTab === 'pixel' ? 'pixel' : 'dashboard');
  }, [activeTab, activeView, connected, setSocketView]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">Observe</h2>
              <p className="text-sm text-slate-400">Live telemetry, replay, and specialized visualizations in one unified observability surface.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {OBSERVE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
                  title={tab.description}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className={activeTab === 'live' ? 'flex flex-col flex-1' : 'hidden'}><DashboardView mode="observe" /></div>
        <div className={activeTab === 'sessions' ? 'flex flex-col flex-1' : 'hidden'}><SessionsView /></div>
        <div className={activeTab === 'pixel' ? 'flex flex-col flex-1' : 'hidden'}><PixelCanvasView /></div>
      </div>
    </div>
  );
}
