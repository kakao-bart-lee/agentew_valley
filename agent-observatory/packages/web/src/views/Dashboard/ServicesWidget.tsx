import { useAgentStore } from '../../stores/agentStore';
import { formatRelativeTime } from '../../utils/formatters';

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  idle: { label: 'online', className: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  acting: { label: 'restarting', className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' },
  thinking: { label: 'online', className: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  waiting_input: { label: 'online', className: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  waiting_permission: { label: 'online', className: 'bg-green-500/20 text-green-400 border border-green-500/30' },
  error: { label: 'errored', className: 'bg-red-500/20 text-red-400 border border-red-500/30' },
};

const DEFAULT_BADGE = { label: 'unknown', className: 'bg-slate-500/20 text-slate-400 border border-slate-500/30' };

export function ServicesWidget() {
    const agents = useAgentStore((s) => s.agents);
    const pm2Agents = Array.from(agents.values()).filter((a) => a.source === 'pm2');

    if (pm2Agents.length === 0) {
        return (
            <p className="text-sm text-slate-500 italic">No PM2 services tracked.</p>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {pm2Agents.map((agent) => {
                const badge = STATUS_BADGE[agent.status] ?? DEFAULT_BADGE;
                const restartCount = agent.total_tool_calls;

                return (
                    <div
                        key={agent.agent_id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-sm font-medium text-slate-200">
                                {agent.agent_name}
                            </span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.className}`}>
                                {badge.label}
                            </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-4 text-xs text-slate-500">
                            {restartCount > 0 && (
                                <span title="Restart count">
                                    ↺ {restartCount}
                                </span>
                            )}
                            <span title="Last activity">
                                {formatRelativeTime(agent.last_activity)}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
