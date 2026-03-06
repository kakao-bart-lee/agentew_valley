import { useEffect } from 'react';
import { ApprovalsView } from '../MissionControl/approvals/ApprovalsView';
import { AdapterSettingsView } from '../MissionControl/adapters/AdapterSettingsView';
import { NotificationList } from '../MissionControl/notifications/NotificationList';
import { useMissionControlStore, type MissionControlTab } from '../../stores/missionControlStore';
import { ActivityTimelineView } from '../Timeline/ActivityTimelineView';
import { useAgentStore } from '../../stores/agentStore';

const CONTROL_TABS: Array<{ id: MissionControlTab; label: string }> = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'activity', label: 'Audit Log' },
  { id: 'adapters', label: 'Adapters' },
  { id: 'notifications', label: 'Notifications' },
];

export function ControlView() {
  const activeView = useAgentStore((state) => state.activeView);
  const activeTab = useMissionControlStore((state) => state.activeTab);
  const setActiveTab = useMissionControlStore((state) => state.setActiveTab);

  useEffect(() => {
    if (activeView !== 'control') {
      return;
    }

    if (!CONTROL_TABS.some((tab) => tab.id === activeTab)) {
      setActiveTab('approvals');
    }
  }, [activeTab, activeView, setActiveTab]);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Control</h2>
            <p className="mt-1 text-sm text-slate-400">Operational approvals, audit trails, adapter health, and notifications are grouped into one control plane.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {CONTROL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === 'approvals' && <ApprovalsView />}
        {activeTab === 'activity' && <ActivityTimelineView />}
        {activeTab === 'adapters' && <AdapterSettingsView />}
        {activeTab === 'notifications' && (
          <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
            <NotificationList />
          </div>
        )}
      </div>
    </div>
  );
}
