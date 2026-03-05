import { useEffect, useState } from 'react';
import type { MissionControlTask, TaskComment, TaskCommentsResponse } from '@agent-observatory/shared';
import { fetchJsonWithAuth, getApiBase } from '../../../lib/api';
import { useMissionControlStore } from '../../../stores/missionControlStore';

function formatTimestamp(unixTs: number): string {
  return new Date(unixTs * 1000).toLocaleString();
}

function RelationList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-200">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TaskDetailPanel({
  task,
  onClose,
}: {
  task: MissionControlTask | null;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [authorAgentId, setAuthorAgentId] = useState(task?.assigned_to ?? 'observatory');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const commentVersion = useMissionControlStore((state) => state.versions.taskComments);

  useEffect(() => {
    setAuthorAgentId(task?.assigned_to ?? 'observatory');
    setBody('');
  }, [task?.id, task?.assigned_to]);

  useEffect(() => {
    if (!task) {
      setComments([]);
      return;
    }

    let cancelled = false;
    const loadComments = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const response = await fetchJsonWithAuth<TaskCommentsResponse>(`${getApiBase()}/api/v2/tasks/${task.id}/comments`);
        if (!cancelled) {
          setComments(response.comments);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setComments([]);
          setLoading(false);
        }
      }
    };

    void loadComments(true);
    const intervalId = window.setInterval(() => {
      void loadComments(false);
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [task?.id, commentVersion]);

  if (!task) {
    return null;
  }

  const submitComment = async () => {
    if (!authorAgentId.trim() || !body.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await fetchJsonWithAuth<TaskCommentsResponse>(`${getApiBase()}/api/v2/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          author_agent_id: authorAgentId.trim(),
          body: body.trim(),
        }),
      });
      setBody('');
      const response = await fetchJsonWithAuth<TaskCommentsResponse>(`${getApiBase()}/api/v2/tasks/${task.id}/comments`);
      setComments(response.comments);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="w-full max-w-[360px] border-l border-slate-700 bg-slate-900/90">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">{task.id}</div>
          <h3 className="truncate text-sm font-semibold text-slate-100">{task.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:text-slate-200"
        >
          Close
        </button>
      </div>

      <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{task.status}</span>
          <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{task.priority}</span>
          {task.project && <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{task.project}</span>}
          {task.goal && <span className="rounded bg-cyan-900/60 px-2 py-1 text-xs text-cyan-200">{task.goal.title}</span>}
          {task.is_blocked && <span className="rounded bg-rose-900/60 px-2 py-1 text-xs text-rose-200">Blocked</span>}
        </div>

        {task.description && (
          <p className="text-sm leading-6 text-slate-300">{task.description}</p>
        )}

        <div className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
          <div className="flex justify-between gap-3"><span>Assignee</span><span className="text-slate-200">{task.assigned_to ?? 'Unassigned'}</span></div>
          <div className="flex justify-between gap-3"><span>Checkout</span><span className="text-slate-200">{task.checkout_agent_id ?? 'Open'}</span></div>
          <div className="flex justify-between gap-3"><span>Updated</span><span className="text-slate-200">{formatTimestamp(task.updated_at)}</span></div>
          <div className="flex justify-between gap-3"><span>Comments</span><span className="text-slate-200">{task.comment_count}</span></div>
        </div>

        <div className="flex flex-col gap-3">
          <RelationList title="Blocked By" items={task.relation_summary.blocked_by} />
          <RelationList title="Blocks" items={task.relation_summary.blocks} />
          <RelationList title="Related" items={task.relation_summary.related} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-100">Comments</span>
            {loading && <span className="text-xs text-slate-500">Loading...</span>}
          </div>

          <div className="flex flex-col gap-2">
            {comments.length === 0 && !loading ? (
              <div className="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-500">
                No comments yet.
              </div>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-200">@{comment.author_agent_id}</span>
                    <span className="text-[11px] text-slate-500">{formatTimestamp(comment.created_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{comment.body}</p>
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex flex-col gap-2">
              <input
                value={authorAgentId}
                onChange={(event) => setAuthorAgentId(event.target.value)}
                placeholder="author agent id"
                className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Add context, blockers, or a handoff note"
                rows={4}
                className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none"
              />
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitComment()}
                className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {submitting ? 'Posting...' : 'Post Comment'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
