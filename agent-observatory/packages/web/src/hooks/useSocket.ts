import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAgentStore } from '../stores/agentStore';
import { useMetricsStore } from '../stores/metricsStore';
import type { AgentLiveState } from '../types/agent';
import type { MetricsSnapshot } from '../types/metrics';

const SOCKET_URL = import.meta.env?.VITE_WEBSOCKET_URL || 'http://localhost:3000';

/** 모듈 레벨 싱글턴 — 앱 전체에서 하나의 소켓만 유지 */
let socketInstance: Socket | null = null;
let refCount = 0;

function getSocket(): Socket {
    if (!socketInstance) {
        socketInstance = io(SOCKET_URL, {
            reconnectionDelayMax: 10000,
            autoConnect: false,
        });
    }
    return socketInstance;
}

interface UseSocketReturn {
    socket: Socket | null;
    subscribe: (agentId: string) => void;
    unsubscribe: (agentId: string) => void;
    setView: (viewName: 'dashboard' | 'pixel' | 'timeline') => void;
}

/**
 * Socket.IO 연결을 관리하는 훅.
 * 여러 컴포넌트에서 호출해도 하나의 소켓 인스턴스를 공유합니다.
 * 스토어 바인딩은 최초 마운트 시 1회만 등록됩니다.
 */
export function useSocket(): UseSocketReturn {
    const { setConnectionStatus, initSession, setAgent, removeAgent } = useAgentStore();
    const { setSnapshot } = useMetricsStore();

    // 연결/해제 로직은 동일하게 유지
    useEffect(() => {
        const socket = getSocket();
        refCount++;

        // 최초 연결 시에만 리스너 등록 + connect
        if (refCount === 1) {
            socket.on('connect', () => {
                setConnectionStatus(true, false);
                socket.emit('set_view', { view: 'dashboard' });
            });

            socket.on('disconnect', () => {
                setConnectionStatus(false, true);
            });

            socket.on('init', (data: { agents: AgentLiveState[]; metrics: MetricsSnapshot }) => {
                initSession(data.agents || []);
                if (data.metrics) setSnapshot(data.metrics);
            });

            socket.on('agent:state', (state: AgentLiveState) => {
                setAgent(state);
            });

            socket.on('agent:remove', (data: { agent_id: string }) => {
                removeAgent(data.agent_id);
            });

            socket.on('metrics:snapshot', (metrics: MetricsSnapshot) => {
                setSnapshot(metrics);
            });

            socket.connect();
        }

        return () => {
            refCount--;
            if (refCount === 0 && socketInstance) {
                socketInstance.removeAllListeners();
                socketInstance.disconnect();
                socketInstance = null;
            }
        };
    }, [setConnectionStatus, initSession, setAgent, removeAgent, setSnapshot]);

    const subscribe = (agentId: string) => {
        if (socketInstance?.connected) {
            socketInstance.emit('subscribe', { agent_id: agentId });
        }
    };

    const unsubscribe = (agentId: string) => {
        if (socketInstance?.connected) {
            socketInstance.emit('unsubscribe', { agent_id: agentId });
        }
    };

    const setView = (viewName: 'dashboard' | 'pixel' | 'timeline') => {
        if (socketInstance?.connected) {
            socketInstance.emit('set_view', { view: viewName });
        }
    };

    return {
        socket: socketInstance,
        subscribe,
        unsubscribe,
        setView
    };
}
