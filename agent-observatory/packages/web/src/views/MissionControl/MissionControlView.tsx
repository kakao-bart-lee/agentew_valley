import { useState } from 'react';
import { TaskBoard } from './tasks/TaskBoard';
import { MigrationStatusPanel } from './migration/MigrationStatusPanel';
import { MCActivityFeed } from './activity/MCActivityFeed';
import { NotificationList } from './notifications/NotificationList';

type SubTab = 'tasks' | 'migration' | 'activity' | 'notifications';

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'migration', label: 'Migration' },
  { id: 'activity', label: 'Activity' },
  { id: 'notifications', label: 'Notifications' },
];

export function MissionControlView() {
  const [activeTab, setActiveTab] = useState<SubTab>('tasks');

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
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'tasks' && <TaskBoard />}
        {activeTab === 'migration' && <MigrationStatusPanel />}
        {activeTab === 'activity' && <MCActivityFeed />}
        {activeTab === 'notifications' && <NotificationList />}
      </div>
    </div>
  );
}
