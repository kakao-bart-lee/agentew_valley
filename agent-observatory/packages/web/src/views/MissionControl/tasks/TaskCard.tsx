interface McTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  project?: string;
  assigned_to?: string;
  checkout_agent_id?: string;
  checkout_at?: number;
  created_by?: string;
  created_at: number;
  started_at?: number;
  updated_at: number;
  due_date?: number;
  tags?: string;
  metadata?: string;
  is_stale?: boolean;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-600 text-slate-200',
  medium: 'bg-blue-700 text-blue-100',
  high: 'bg-amber-700 text-amber-100',
  urgent: 'bg-red-700 text-red-100',
  critical: 'bg-red-700 text-red-100',
};

function formatProjectLabel(project?: string): string | null {
  if (!project) return null;
  if (project.startsWith('/')) {
    return project.split('/').filter(Boolean).pop() ?? project;
  }
  return project;
}

function formatAge(seconds: number): string {
  if (seconds >= 86_400) {
    return `${Math.floor(seconds / 86_400)}d`;
  }
  if (seconds >= 3_600) {
    return `${Math.floor(seconds / 3_600)}h`;
  }
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${seconds}s`;
}

export function TaskCard({ task }: { task: McTask }) {
  const tags: string[] = (() => {
    try {
      return task.tags ? JSON.parse(task.tags) : [];
    } catch {
      return [];
    }
  })();

  const priorityColor = PRIORITY_COLORS[task.priority] ?? 'bg-slate-600 text-slate-200';
  const projectLabel = formatProjectLabel(task.project);
  const staleForSeconds = task.is_stale
    ? Math.max(Math.floor(Date.now() / 1000) - (task.started_at ?? task.updated_at), 0)
    : 0;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-600 bg-slate-700 p-3 transition-colors hover:border-slate-500">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {task.checkout_agent_id && (
            <span
              className="mt-0.5 text-sm"
              title={`Checked out by ${task.checkout_agent_id}`}
            >
              🔒
            </span>
          )}
          <span className="flex-1 text-sm font-medium leading-snug text-slate-100">
            {task.title}
          </span>
        </div>
        <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${priorityColor}`}>
          {task.priority}
        </span>
      </div>

      {task.description && (
        <p className="line-clamp-2 text-xs text-slate-400">{task.description}</p>
      )}

      <div className="flex flex-wrap gap-1">
        {projectLabel && (
          <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-200">
            {projectLabel}
          </span>
        )}
        {task.is_stale && (
          <span className="rounded bg-amber-900/70 px-1.5 py-0.5 text-[10px] text-amber-200">
            Stale {formatAge(staleForSeconds)}
          </span>
        )}
        {tags.slice(0, 2).map((tag) => (
          <span key={tag} className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] text-slate-300">
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
        <div className="truncate">
          {task.checkout_agent_id ? `locked by @${task.checkout_agent_id}` : 'available'}
        </div>
        {task.assigned_to && (
          <span className="truncate" title={task.assigned_to}>
            @{task.assigned_to}
          </span>
        )}
      </div>
    </div>
  );
}
