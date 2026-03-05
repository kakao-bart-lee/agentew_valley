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

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-600 text-slate-200',
  medium: 'bg-blue-700 text-blue-100',
  high: 'bg-amber-700 text-amber-100',
  urgent: 'bg-red-700 text-red-100',
  critical: 'bg-red-700 text-red-100',
};

export function TaskCard({ task }: { task: McTask }) {
  const tags: string[] = (() => {
    try { return task.tags ? JSON.parse(task.tags) : []; } catch { return []; }
  })();

  const priorityColor = PRIORITY_COLORS[task.priority] ?? 'bg-slate-600 text-slate-200';

  return (
    <div className="bg-slate-700 rounded-lg p-3 flex flex-col gap-2 border border-slate-600 hover:border-slate-500 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-slate-100 leading-snug flex-1">{task.title}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase whitespace-nowrap ${priorityColor}`}>
          {task.priority}
        </span>
      </div>

      {task.description && (
        <p className="text-xs text-slate-400 line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center justify-between gap-2 mt-1">
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[10px] bg-slate-600 text-slate-300 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
        {task.assigned_to && (
          <span className="text-[10px] text-slate-400 truncate max-w-[100px]" title={task.assigned_to}>
            @{task.assigned_to}
          </span>
        )}
      </div>
    </div>
  );
}
