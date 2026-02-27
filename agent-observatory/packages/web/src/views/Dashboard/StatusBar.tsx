import { useAgentStore } from '../../stores/agentStore';
import { useMetricsStore } from '../../stores/metricsStore';
import { useSocket } from '../../hooks/useSocket';
import { formatCurrency, formatLargeNumber } from '../../utils/formatters';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';

export function StatusBar() {
    const { connected, reconnecting, agents, activeView, setView: setStoreView } = useAgentStore();
    const { snapshot } = useMetricsStore();
    const { setView: setSocketView } = useSocket();

    const activeAgents = Array.from(agents.values()).filter(a => a.status !== 'idle').length;
    const totalAgents = agents.size;

    const tpm = snapshot?.total_tokens_per_minute || 0;
    const cph = snapshot?.total_cost_per_hour || 0;
    const errors = snapshot?.total_errors_last_hour || 0;

    return (
        <Card className="flex flex-row items-center justify-between p-3 mx-4 mt-4 bg-slate-800 border-slate-700 text-slate-50">
            <div className="flex gap-6 items-center flex-wrap">
                {/* View Switcher */}
                <div className="flex bg-slate-900 rounded-lg p-1 mr-2">
                    <button
                        onClick={() => {
                            setStoreView('dashboard');
                            setSocketView('dashboard');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'dashboard' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Dashboard
                    </button>
                    <button
                        onClick={() => {
                            setStoreView('pixel');
                            setSocketView('pixel');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'pixel' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Pixel
                    </button>
                    <button
                        onClick={() => {
                            setStoreView('sessions');
                            setSocketView('dashboard');
                        }}
                        className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${activeView === 'sessions' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Sessions
                    </button>
                </div>

                {/* Connection Status */}
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${connected ? 'bg-emerald-500' : reconnecting ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                        }`} />
                    <span className="text-sm font-medium">
                        {connected ? 'Connected' : reconnecting ? 'Reconnecting...' : 'Disconnected'}
                    </span>
                </div>

                {/* Global Metrics */}
                <div className="flex gap-4 text-sm items-center divide-x divide-slate-600">
                    <div className="pl-4 first:pl-0 flex items-center gap-2">
                        <span className="text-slate-400">Active:</span>
                        <span className="font-semibold">{activeAgents} / {totalAgents}</span>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Tokens/min:</span>
                        <span className="font-semibold">{formatLargeNumber(tpm)}</span>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Cost/hr:</span>
                        <span className="font-semibold">{formatCurrency(cph)}</span>
                    </div>

                    <div className="pl-4 flex items-center gap-2">
                        <span className="text-slate-400">Errors (1h):</span>
                        <Badge variant={errors > 0 ? "destructive" : "secondary"} className={errors === 0 ? "bg-slate-700 hover:bg-slate-600" : ""}>
                            {errors}
                        </Badge>
                    </div>
                </div>
            </div>
        </Card>
    );
}
