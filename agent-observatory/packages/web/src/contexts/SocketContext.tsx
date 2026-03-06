import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RealtimeActivityPayload } from '@agent-observatory/shared';
import { useAgentStore } from '../stores/agentStore';
import { useMetricsStore } from '../stores/metricsStore';
import { useMissionControlStore } from '../stores/missionControlStore';
import type { AgentLiveState } from '../types/agent';
import type { MetricsSnapshot } from '../types/metrics';
import { getSocketUrl } from '../lib/api';

export interface SocketContextValue {
    socket: Socket | null;
    subscribe: (agentId: string) => void;
    unsubscribe: (agentId: string) => void;
    setView: (viewName: 'dashboard' | 'pixel' | 'timeline') => void;
}

const SocketContext = createContext<SocketContextValue>({
    socket: null,
    subscribe: () => {},
    unsubscribe: () => {},
    setView: () => {},
});

/**
 * 앱 전체에서 Socket.IO 연결을 단일 인스턴스로 관리하는 Provider.
 * StrictMode 안전: useEffect 의존성 없이 단일 소켓 생명주기를 보장합니다.
 */
function mapActiveViewToSocketView(
    view: ReturnType<typeof useAgentStore.getState>['activeView'],
): 'dashboard' | 'pixel' | 'timeline' {
    if (view === 'pixel') return 'pixel';
    if (view === 'timeline') return 'timeline';
    return 'dashboard';
}

export function SocketProvider({ children }: { children: ReactNode }) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const socketRef = useRef<Socket | null>(null);

    // zustand 액션은 stable 참조 — 소켓 초기화에 안전하게 사용
    const { setConnectionStatus, initSession, setAgent, removeAgent } = useAgentStore();
    const { setSnapshot } = useMetricsStore();
    const bumpMissionControl = useMissionControlStore((state) => state.bump);

    useEffect(() => {
        const token = localStorage.getItem('OBSERVATORY_TOKEN') || (import.meta as any).env?.VITE_DASHBOARD_API_KEY;
        const s = io(getSocketUrl(), {
            reconnectionDelayMax: 10000,
            autoConnect: false,
            auth: { token },
        });
        socketRef.current = s;

        s.on('connect', () => {
            setConnectionStatus(true, false);
            s.emit('set_view', mapActiveViewToSocketView(useAgentStore.getState().activeView));
        });

        s.on('disconnect', () => {
            setConnectionStatus(false, true);
            initSession([]); // 연결 해제 시 stale 에이전트 제거
        });

        s.on('init', (data: { agents: AgentLiveState[]; metrics: MetricsSnapshot }) => {
            initSession(data.agents || []);
            if (data.metrics) setSnapshot(data.metrics);
        });

        s.on('agent:state', (state: AgentLiveState) => {
            setAgent(state);
        });

        s.on('agent.status', ({ agent }: { agent: AgentLiveState }) => {
            setAgent(agent);
        });

        s.on('agent:remove', (data: { agent_id: string }) => {
            removeAgent(data.agent_id);
        });

        s.on('metrics:snapshot', (metrics: MetricsSnapshot) => {
            setSnapshot(metrics);
        });

        s.on('event', (event: { type?: string }) => {
            if (event.type === 'goal.snapshot') {
                bumpMissionControl(['goals', 'summary']);
            }
            if (event.type === 'task.snapshot') {
                bumpMissionControl(['tasks', 'summary']);
            }
        });

        s.on('task.updated', () => {
            bumpMissionControl(['tasks', 'summary']);
        });

        s.on('task.checkout', () => {
            bumpMissionControl(['tasks', 'summary', 'activities']);
        });

        s.on('activity.logged', (activity: RealtimeActivityPayload) => {
            const keys: Array<'activities' | 'summary' | 'taskComments' | 'approvals'> = ['activities', 'summary'];
            if (activity.type === 'task_comment' && activity.entity_type === 'task') {
                keys.push('taskComments');
            }
            if (activity.entity_type === 'approval') {
                keys.push('approvals');
            }
            bumpMissionControl(keys);
        });

        s.on('approval.created', () => {
            bumpMissionControl(['approvals', 'activities', 'summary']);
        });

        s.on('approval.updated', () => {
            bumpMissionControl(['approvals', 'activities', 'summary']);
        });

        s.on('cost.alert', () => {
            bumpMissionControl(['summary', 'activities', 'notifications']);
        });

        s.connect();
        setSocket(s);

        return () => {
            s.removeAllListeners();
            s.disconnect();
            socketRef.current = null;
            setSocket(null);
        };
    }, [setConnectionStatus, initSession, setAgent, removeAgent, setSnapshot, bumpMissionControl]);

    // socketRef 기반으로 안정적인(stable) 콜백 제공
    const subscribe = useCallback((agentId: string) => {
        if (socketRef.current?.connected) socketRef.current.emit('subscribe', agentId);
    }, []);

    const unsubscribe = useCallback((agentId: string) => {
        if (socketRef.current?.connected) socketRef.current.emit('unsubscribe', agentId);
    }, []);

    const setView = useCallback((viewName: 'dashboard' | 'pixel' | 'timeline') => {
        if (socketRef.current?.connected) socketRef.current.emit('set_view', viewName);
    }, []);

    const value = useMemo(
        () => ({ socket, subscribe, unsubscribe, setView }),
        [socket, subscribe, unsubscribe, setView],
    );

    return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
    return useContext(SocketContext);
}
