import { GoalProgressCard } from '../Dashboard/GoalProgressCard';
import { TaskBoard } from '../MissionControl/tasks/TaskBoard';

export function WorkView() {
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <h2 className="text-xl font-semibold text-slate-100">Work</h2>
        <p className="mt-1 text-sm text-slate-400">Task coordination, goal rollups, comments, dependencies, and checkout live together here.</p>
      </div>

      <GoalProgressCard />

      <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
        <TaskBoard />
      </div>
    </div>
  );
}
