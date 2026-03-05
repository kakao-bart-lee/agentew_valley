import { TaskBoard } from '../MissionControl/tasks/TaskBoard';
import { MCActivityFeed } from '../MissionControl/activity/MCActivityFeed';
import { NotificationList } from '../MissionControl/notifications/NotificationList';
import { MigrationStatusPanel } from '../MissionControl/migration/MigrationStatusPanel';

export function MissionControlSummarySection() {
    return (
        <div className="flex flex-col gap-6">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-100">Mission Control: Task Lifecycle</h2>
                    <span className="text-xs text-slate-500">/api/v2/tasks</span>
                </div>
                <TaskBoard />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col min-h-[360px]">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h3 className="text-base font-semibold text-slate-100">Activity Feed</h3>
                        <span className="text-xs text-slate-500">/api/v2/activities</span>
                    </div>
                    <div className="flex-1 overflow-auto pr-1 custom-scrollbar">
                        <MCActivityFeed />
                    </div>
                </div>

                <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col min-h-[360px]">
                    <div className="flex items-center justify-between gap-3 mb-3">
                        <h3 className="text-base font-semibold text-slate-100">Notifications</h3>
                        <span className="text-xs text-slate-500">/api/v2/notifications</span>
                    </div>
                    <div className="flex-1 overflow-auto pr-1 custom-scrollbar">
                        <NotificationList />
                    </div>
                </div>
            </div>

            <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-100">Migration Guardrails</h2>
                    <span className="text-xs text-slate-500">/api/v1/config · /api/v1/migration/shadow-report</span>
                </div>
                <MigrationStatusPanel />
            </div>
        </div>
    );
}
