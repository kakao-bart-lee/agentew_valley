import { useEffect } from 'react';
import { MigrationStatusPanel } from '../MissionControl/migration/MigrationStatusPanel';
import { useAgentStore } from '../../stores/agentStore';
import { useMissionControlStore } from '../../stores/missionControlStore';

export function AdminView() {
  const activeView = useAgentStore((state) => state.activeView);
  const activeTab = useMissionControlStore((state) => state.activeTab);
  const setActiveTab = useMissionControlStore((state) => state.setActiveTab);

  useEffect(() => {
    if (activeView === 'admin' && activeTab !== 'migration') {
      setActiveTab('migration');
    }
  }, [activeTab, activeView, setActiveTab]);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="text-xl font-semibold text-slate-100">Admin</h2>
        <p className="mt-1 text-sm text-slate-400">Migration, shadow-mode checks, and debug-only tooling stay isolated from daily operating surfaces.</p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <MigrationStatusPanel />
      </div>
    </div>
  );
}
