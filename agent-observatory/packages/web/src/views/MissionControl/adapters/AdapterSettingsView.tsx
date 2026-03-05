import { useEffect, useState } from 'react';
import type {
  AdaptersResponse,
  AdapterSummary,
  AdapterTestResponse,
} from '@agent-observatory/shared';
import { fetchJsonWithAuth, getApiBase } from '../../../lib/api';
import { useMissionControlStore } from '../../../stores/missionControlStore';
import { Button } from '../../../components/ui/button';

const CAPABILITY_LABELS: Array<keyof AdapterSummary['capabilities']> = [
  'costTracking',
  'logStreaming',
  'statusUpdates',
  'goalParsing',
  'taskSync',
];

const STATUS_STYLES: Record<AdapterSummary['status'], string> = {
  ready: 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200',
  stub: 'border-amber-500/40 bg-amber-500/20 text-amber-200',
  error: 'border-rose-500/40 bg-rose-500/20 text-rose-200',
};

export function AdapterSettingsView() {
  const [data, setData] = useState<AdaptersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingType, setTestingType] = useState<string | null>(null);
  const version = useMissionControlStore((state) => state.versions.adapters);

  useEffect(() => {
    let cancelled = false;

    const load = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setLoading(true);
      }

      try {
        const nextData = await fetchJsonWithAuth<AdaptersResponse>(`${getApiBase()}/api/v2/adapters`);
        if (!cancelled) {
          setData(nextData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData({ domain: 'adapters', version: 'v2', adapters: [], total: 0 });
          setLoading(false);
        }
      }
    };

    void load(true);

    return () => {
      cancelled = true;
    };
  }, [version]);

  const testAdapter = async (type: string) => {
    setTestingType(type);
    try {
      await fetchJsonWithAuth<AdapterTestResponse>(`${getApiBase()}/api/v2/adapters/${type}/test`, {
        method: 'POST',
      });
      useMissionControlStore.getState().bump('adapters');
    } finally {
      setTestingType(null);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-slate-400">Loading adapters...</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {(data?.adapters ?? []).map((adapter) => (
        <div key={adapter.type} className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">{adapter.label}</h3>
              <p className="text-sm text-slate-500">{adapter.type}</p>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[adapter.status]}`}>
              {adapter.status}
            </span>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            {CAPABILITY_LABELS.map((capability) => (
              <div key={capability} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{capability}</div>
                <div className={`mt-1 text-sm font-medium ${adapter.capabilities[capability] ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {adapter.capabilities[capability] ? 'Supported' : 'Unavailable'}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4 rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
            {adapter.last_test_result?.message ?? 'No connection test has been run yet.'}
          </div>

          <Button type="button" onClick={() => void testAdapter(adapter.type)} disabled={testingType !== null}>
            {testingType === adapter.type ? 'Testing...' : 'Test Connection'}
          </Button>
        </div>
      ))}
    </div>
  );
}
