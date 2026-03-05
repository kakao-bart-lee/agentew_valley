import { useEffect, useMemo, useState } from 'react';
import type {
  Approval,
  ApprovalResponse,
  ApprovalsResponse,
  ApprovalStatus,
} from '@agent-observatory/shared';
import { fetchJsonWithAuth, getApiBase } from '../../../lib/api';
import { useMissionControlStore } from '../../../stores/missionControlStore';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';

type ApprovalFilter = 'pending' | 'all';

const STATUS_STYLES: Record<ApprovalStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  approved: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  rejected: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  revision_requested: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
};

function formatRelativeTime(unixTs: number): string {
  const diff = Math.max(Math.floor(Date.now() / 1000) - unixTs, 0);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatPayload(payload: Approval['payload']): string {
  if (!payload) return 'No payload provided.';
  return JSON.stringify(payload, null, 2);
}

export function ApprovalsView() {
  const [filter, setFilter] = useState<ApprovalFilter>('pending');
  const [listData, setListData] = useState<ApprovalsResponse | null>(null);
  const [detailData, setDetailData] = useState<ApprovalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [decisionNote, setDecisionNote] = useState('');
  const [submitting, setSubmitting] = useState<ApprovalStatus | null>(null);
  const approvalsVersion = useMissionControlStore((state) => state.versions.approvals);
  const selectedApprovalId = useMissionControlStore((state) => state.selectedApprovalId);
  const selectApproval = useMissionControlStore((state) => state.selectApproval);

  useEffect(() => {
    let cancelled = false;

    const loadList = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const nextData = await fetchJsonWithAuth<ApprovalsResponse>(
          `${getApiBase()}/api/v2/approvals?status=${filter}&limit=100`,
        );
        if (!cancelled) {
          setListData(nextData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setListData({
            domain: 'approvals',
            version: 'v2',
            approvals: [],
            total: 0,
            pending: 0,
            mc_db_connected: false,
          });
          setLoading(false);
        }
      }
    };

    void loadList(true);
    const intervalId = window.setInterval(() => {
      void loadList(false);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [approvalsVersion, filter]);

  const approvals = listData?.approvals ?? [];
  const pendingCount = listData?.pending ?? 0;

  useEffect(() => {
    if (approvals.length === 0) {
      selectApproval(null);
      return;
    }

    if (!selectedApprovalId || !approvals.some((approval) => approval.id === selectedApprovalId)) {
      selectApproval(approvals[0].id);
    }
  }, [approvals, selectedApprovalId, selectApproval]);

  useEffect(() => {
    if (!selectedApprovalId) {
      setDetailData(null);
      return;
    }

    let cancelled = false;

    const loadDetail = async () => {
      try {
        const nextDetail = await fetchJsonWithAuth<ApprovalResponse>(
          `${getApiBase()}/api/v2/approvals/${selectedApprovalId}`,
        );
        if (!cancelled) {
          setDetailData(nextDetail);
        }
      } catch {
        if (!cancelled) {
          setDetailData(null);
        }
      }
    };

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedApprovalId, approvalsVersion]);

  useEffect(() => {
    setDecisionNote(detailData?.approval?.decision_note ?? '');
  }, [detailData?.approval?.id, detailData?.approval?.decision_note]);

  const selectedApproval = detailData?.approval ?? null;
  const decisionActions = useMemo(
    () => ([
      { status: 'approved', label: 'Approve' },
      { status: 'rejected', label: 'Deny' },
      { status: 'revision_requested', label: 'Request Revision' },
    ] as const),
    [],
  );

  const submitDecision = async (status: Exclude<ApprovalStatus, 'pending'>) => {
    if (!selectedApproval) return;
    setSubmitting(status);
    try {
      await fetchJsonWithAuth<ApprovalResponse>(`${getApiBase()}/api/v2/approvals/${selectedApproval.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          decision_note: decisionNote,
          decided_by: 'user',
        }),
      });
      useMissionControlStore.getState().bump(['approvals', 'activities', 'summary']);
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-slate-400">Loading approvals...</div>;
  }

  if (!listData?.mc_db_connected) {
    return (
      <div className="rounded-lg border border-slate-600 bg-slate-800 p-4 text-sm text-slate-400">
        Mission Control DB is not connected.
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(['pending', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === value
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {value === 'pending' ? 'Pending' : 'All'}
              </button>
            ))}
          </div>
          <Badge className="border border-amber-500/40 bg-amber-500/20 text-amber-200">
            {pendingCount} pending
          </Badge>
        </div>

        <div className="flex flex-col gap-2">
          {approvals.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
              No approvals in this filter.
            </div>
          ) : (
            approvals.map((approval) => (
              <button
                key={approval.id}
                type="button"
                onClick={() => selectApproval(approval.id)}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selectedApprovalId === approval.id
                    ? 'border-cyan-500 bg-cyan-950/30'
                    : 'border-slate-700 bg-slate-950/60 hover:border-slate-600'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-100">{approval.type}</div>
                    <div className="text-xs text-slate-500">{approval.id}</div>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLES[approval.status]}`}>
                    {approval.status}
                  </span>
                </div>
                <div className="text-xs text-slate-400">Requested by {approval.requested_by}</div>
                <div className="mt-2 text-[11px] text-slate-500">{formatRelativeTime(approval.created_at)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
        {!selectedApproval ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Select an approval to review.
          </div>
        ) : (
          <div className="flex h-full flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">{selectedApproval.type}</h3>
                <p className="text-sm text-slate-400">
                  Requested by <span className="text-slate-200">{selectedApproval.requested_by}</span>
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[selectedApproval.status]}`}>
                {selectedApproval.status}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Created</div>
                <div className="mt-1 text-sm text-slate-200">{formatRelativeTime(selectedApproval.created_at)}</div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Decided By</div>
                <div className="mt-1 text-sm text-slate-200">{selectedApproval.decided_by ?? 'Pending'}</div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Decision Time</div>
                <div className="mt-1 text-sm text-slate-200">
                  {selectedApproval.decided_at ? formatRelativeTime(selectedApproval.decided_at) : 'Pending'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
              <div className="mb-2 text-sm font-semibold text-slate-100">Payload Context</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-300">
                {formatPayload(selectedApproval.payload)}
              </pre>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4">
              <label className="mb-2 block text-sm font-semibold text-slate-100">Decision Note</label>
              <textarea
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
                rows={5}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition-colors focus:border-cyan-500"
                placeholder="Add context for the decision."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {decisionActions.map((action) => (
                <Button
                  key={action.status}
                  type="button"
                  onClick={() => void submitDecision(action.status)}
                  disabled={submitting !== null}
                  className={action.status === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : action.status === 'rejected'
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-cyan-700 hover:bg-cyan-600'}
                >
                  {submitting === action.status ? 'Saving...' : action.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
