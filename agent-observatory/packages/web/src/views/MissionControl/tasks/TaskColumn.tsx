import { TaskCard } from './TaskCard';

interface McTask {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assigned_to?: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  due_date?: number;
  tags?: string;
}

const STATUS_LABELS: Record<string, string> = {
  inbox: 'Inbox',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  review: 'Review',
  quality_review: 'Quality Review',
  done: 'Done',
};

const STATUS_HEADER_COLORS: Record<string, string> = {
  inbox: 'text-slate-400',
  assigned: 'text-blue-400',
  in_progress: 'text-amber-400',
  review: 'text-purple-400',
  quality_review: 'text-pink-400',
  done: 'text-emerald-400',
};

export function TaskColumn({ status, tasks }: { status: string; tasks: McTask[] }) {
  const label = STATUS_LABELS[status] ?? status;
  const headerColor = STATUS_HEADER_COLORS[status] ?? 'text-slate-400';

  return (
    <div className="flex flex-col gap-2 min-w-[180px] flex-1">
      <div className="flex items-center gap-2 px-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${headerColor}`}>{label}</span>
        <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full font-medium">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 min-h-[100px]">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {tasks.length === 0 && (
          <div className="text-xs text-slate-600 italic px-1">Empty</div>
        )}
      </div>
    </div>
  );
}
