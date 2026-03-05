import { useEffect, useState } from 'react';
import { TaskBoard } from './tasks/TaskBoard';
import { MigrationStatusPanel } from './migration/MigrationStatusPanel';
import { MCActivityFeed } from './activity/MCActivityFeed';
import { NotificationList } from './notifications/NotificationList';
import type { ApprovalsResponse } from '@agent-observatory/shared';
import { ApprovalsView } from './approvals/ApprovalsView';
import { AdapterSettingsView } from './adapters/AdapterSettingsView';
import { fetchJsonWithAuth, getApiBase } from '../../lib/api';
import { useMissionControlStore, type MissionControlTab } from '../../stores/missionControlStore';

const SUBTABS: Array<{ id: MissionControlTab; label: string }> = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'adapters', label: 'Adapters' },
  { id: 'migration', label: 'Migration' },
  { id: 'activity', label: 'Activity' },
  { id: 'notifications', label: 'Notifications' },
];

export function MissionControlView() {
  const activeTab = useMissionControlStore((state) => state.activeTab);
  const setActiveTab = useMissionControlStore((state) => state.setActiveTab);
  const approvalsVersion = useMissionControlStore((state) => state.versions.approvals);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadPendingCount = async () => {
      try {
        const response = await fetchJsonWithAuth<ApprovalsResponse>(`${getApiBase()}/api/v2/approvals?status=pending&limit=1`);
        if (!cancelled) {
          setPendingApprovals(response.pending);
        }
      } catch {
        if (!cancelled) {
          setPendingApprovals(0);
        }
      }
    };

    void loadPendingCount();

    return () => {
      cancelled = true;
    };
  }, [approvalsVersion]);

  return (
    <div className="flex flex-col flex-1 p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Mission Control</h2>
      </div>

      {/* Sub-tab nav */}
      <div className="flex bg-slate-800 rounded-lg p-1 gap-1 self-start border border-slate-700">
        {SUBTABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
            {tab.id === 'approvals' && pendingApprovals > 0 ? (
              <span className="ml-2 rounded-full bg-amber-500/25 px-2 py-0.5 text-[11px] text-amber-200">
                {pendingApprovals}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'tasks' && <TaskBoard />}
        {activeTab === 'approvals' && <ApprovalsView />}
        {activeTab === 'adapters' && <AdapterSettingsView />}
        {activeTab === 'migration' && <MigrationStatusPanel />}
        {activeTab === 'activity' && <MCActivityFeed />}
        {activeTab === 'notifications' && <NotificationList />}
      </div>
    </div>
  );
}
