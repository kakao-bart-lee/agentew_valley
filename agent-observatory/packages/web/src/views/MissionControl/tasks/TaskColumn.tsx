import { TaskCard } from './TaskCard';
import type { MissionControlTask } from '@agent-observatory/shared';

const COLUMN_ACCENTS: Record<string, string> = {
  inbox: 'text-slate-400',
  assigned: 'text-blue-400',
  in_progress: 'text-amber-400',
  review: 'text-purple-400',
  quality_review: 'text-pink-400',
  done: 'text-emerald-400',
  agent: 'text-cyan-300',
  project: 'text-emerald-300',
};

export function TaskColumn({
  title,
  accent,
  tasks,
  onSelectTask,
}: {
  title: string;
  accent: string;
  tasks: MissionControlTask[];
  onSelectTask?: (task: MissionControlTask) => void;
}) {
  const headerColor = COLUMN_ACCENTS[accent] ?? 'text-slate-300';

  return (
    <div className="flex min-w-[220px] flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${headerColor}`}>{title}</span>
        <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          {tasks.length}
        </span>
      </div>
      <div className="flex min-h-[100px] flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onClick={() => onSelectTask?.(task)} />
        ))}
        {tasks.length === 0 && (
          <div className="px-1 text-xs italic text-slate-600">Empty</div>
        )}
      </div>
    </div>
  );
}
