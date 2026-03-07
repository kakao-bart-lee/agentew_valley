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
import { useAgentStore } from '../stores/agentStore';
import { useMetricsStore } from '../stores/metricsStore';
import type { AgentLiveState } from '../types/agent';
import type { MetricsSnapshot } from '../types/metrics';
import { getSocketUrl } from '../lib/api';

export interface SocketContextValue {
    socket: Socket | null;
    subscribe: (agentId: string) => void;
    unsubscribe: (agentId: string) => void;
    setView: (viewName: 'dashboard' | 'pixel') => void;
}

const SocketContext = createContext<SocketContextValue>({
    socket: null,
    subscribe: () => {},
    unsubscribe: () => {},
    setView: () => {},
});

export function SocketProvider({ children }: { children: ReactNode }) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const socketRef = useRef<Socket | null>(null);

    // zustand 액션은 stable 참조 — 소켓 초기화에 안전하게 사용
    const { setConnectionStatus, initSession, setAgent, removeAgent } = useAgentStore();
    const { setSnapshot } = useMetricsStore();

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
            s.emit('set_view', 'dashboard');
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

        s.connect();
        setSocket(s);

        return () => {
            s.removeAllListeners();
            s.disconnect();
            socketRef.current = null;
            setSocket(null);
        };
    }, [setConnectionStatus, initSession, setAgent, removeAgent, setSnapshot]);

    // socketRef 기반으로 안정적인(stable) 콜백 제공
    const subscribe = useCallback((agentId: string) => {
        if (socketRef.current?.connected) socketRef.current.emit('subscribe', agentId);
    }, []);

    const unsubscribe = useCallback((agentId: string) => {
        if (socketRef.current?.connected) socketRef.current.emit('unsubscribe', agentId);
    }, []);

    const setView = useCallback((viewName: 'dashboard' | 'pixel') => {
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
