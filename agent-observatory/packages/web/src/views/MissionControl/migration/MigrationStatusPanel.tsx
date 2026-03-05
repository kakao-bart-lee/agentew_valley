import { useEffect, useState } from 'react';

interface FeatureFlagInfo {
  name: string;
  enabled: boolean;
  env_var: string;
}

interface ConfigResponse {
  config: {
    watch_paths: string[];
    shadow_mode_enabled: boolean;
    mc_db_connected: boolean;
  };
  feature_flags: FeatureFlagInfo[];
}

interface ShadowReportDiff {
  entity: string;
  path: string;
  count: number;
}

interface ShadowReportResponse {
  pass_count?: number;
  fail_count?: number;
  top_diffs?: ShadowReportDiff[];
  code?: string;
  error?: string;
}

export function MigrationStatusPanel() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [shadowReport, setShadowReport] = useState<ShadowReportResponse | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingShadow, setLoadingShadow] = useState(true);

  const apiBase = (window as any).__OBSERVATORY_API__ ?? 'http://localhost:3000';

  useEffect(() => {
    fetch(`${apiBase}/api/v1/config`)
      .then((r) => r.json())
      .then((d: ConfigResponse) => { setConfig(d); setLoadingConfig(false); })
      .catch(() => { setLoadingConfig(false); });
  }, []);

  useEffect(() => {
    fetch(`${apiBase}/api/v1/migration/shadow-report`)
      .then((r) => r.json())
      .then((d: ShadowReportResponse) => { setShadowReport(d); setLoadingShadow(false); })
      .catch(() => { setLoadingShadow(false); });
  }, []);

  const flags = config?.feature_flags ?? [];

  const passCount = shadowReport?.pass_count ?? 0;
  const failCount = shadowReport?.fail_count ?? 0;
  const total = passCount + failCount;
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Feature Flags 그리드 */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Feature Flags</h3>
        {loadingConfig ? (
          <div className="text-slate-400 text-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {flags.map((flag) => (
              <div
                key={flag.name}
                className="bg-slate-700 border border-slate-600 rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium text-slate-200">{flag.name}</span>
                  <code className="text-[10px] text-slate-500 truncate">{flag.env_var}</code>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded whitespace-nowrap ${
                    flag.enabled
                      ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
                      : 'bg-slate-600 text-slate-400 border border-slate-500'
                  }`}
                >
                  {flag.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            ))}
            {flags.length === 0 && (
              <div className="text-slate-500 text-sm col-span-2">Feature flag 정보를 불러올 수 없습니다.</div>
            )}
          </div>
        )}

        {config && (
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span>Shadow mode: <span className={config.config.shadow_mode_enabled ? 'text-emerald-400' : 'text-slate-400'}>{config.config.shadow_mode_enabled ? 'ON' : 'OFF'}</span></span>
            <span>MC DB: <span className={config.config.mc_db_connected ? 'text-emerald-400' : 'text-slate-400'}>{config.config.mc_db_connected ? 'Connected' : 'Not connected'}</span></span>
          </div>
        )}
      </div>

      {/* Shadow Report */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Shadow Report</h3>
        {loadingShadow ? (
          <div className="text-slate-400 text-sm">Loading...</div>
        ) : shadowReport?.code === 'SHADOW_MODE_DISABLED' ? (
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 text-slate-400 text-sm">
            Shadow mode가 비활성화되어 있습니다.
            <br />
            <code className="bg-slate-700 px-1 rounded text-xs mt-1 inline-block">OBSERVATORY_SHADOW_MODE_ENABLED=true</code> 환경변수를 설정하세요.
          </div>
        ) : shadowReport?.code === 'SHADOW_MODE_READ_ONLY_REQUIRED' ? (
          <div className="bg-amber-900/30 border border-amber-700 rounded-lg p-4 text-amber-300 text-sm">
            Shadow mode가 read-only 모드가 아닙니다. <code className="bg-amber-900/50 px-1 rounded">OBSERVATORY_SHADOW_MODE_READ_ONLY=true</code> 설정이 필요합니다.
          </div>
        ) : shadowReport && shadowReport.pass_count !== undefined ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-300">{passCount.toLocaleString()}</div>
                <div className="text-xs text-emerald-500 mt-1">Pass</div>
              </div>
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-300">{failCount.toLocaleString()}</div>
                <div className="text-xs text-red-500 mt-1">Fail</div>
              </div>
              <div className="bg-slate-700 border border-slate-600 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold ${passRate >= 95 ? 'text-emerald-300' : passRate >= 80 ? 'text-amber-300' : 'text-red-300'}`}>
                  {passRate}%
                </div>
                <div className="text-xs text-slate-500 mt-1">Pass Rate</div>
              </div>
            </div>

            {shadowReport.top_diffs && shadowReport.top_diffs.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-400 mb-2">Top Diffs</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-700">
                        <th className="text-left pb-2 pr-4">Entity</th>
                        <th className="text-left pb-2 pr-4">Path</th>
                        <th className="text-right pb-2">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shadowReport.top_diffs.map((diff, i) => (
                        <tr key={i} className="border-b border-slate-800 text-slate-300">
                          <td className="py-1.5 pr-4">{diff.entity}</td>
                          <td className="py-1.5 pr-4 font-mono text-slate-400">{diff.path}</td>
                          <td className="py-1.5 text-right text-slate-200">{diff.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-500 text-sm">Shadow report 데이터를 불러올 수 없습니다.</div>
        )}
      </div>
    </div>
  );
}
