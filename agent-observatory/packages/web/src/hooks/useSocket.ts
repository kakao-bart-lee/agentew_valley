import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAgentStore } from '../stores/agentStore';
import { useMetricsStore } from '../stores/metricsStore';
import { AgentLiveState } from '../types/agent';
import { MetricsSnapshot } from '../types/metrics';

// Since the dashboard team is working independently, providing a simple config
const SOCKET_URL = import.meta.env?.VITE_WEBSOCKET_URL || 'http://localhost:3000';

export function useSocket() {
    const socketRef = useRef<Socket | null>(null);
    const { setConnectionStatus, initSession, setAgent, removeAgent } = useAgentStore();
    const { setSnapshot } = useMetricsStore();

    useEffect(() => {
        // 1. Connect
        const socket = io(SOCKET_URL, {
            reconnectionDelayMax: 10000,
        });
        socketRef.current = socket;

        // 2. Event Listeners
        socket.on('connect', () => {
            setConnectionStatus(true, false);
            socket.emit('set_view', { view: 'dashboard' }); // Optimization hint
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

        // Activity Feed listener is handled separately or buffered inside `useActivityFeed`

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [setConnectionStatus, initSession, setAgent, removeAgent, setSnapshot]);

    return socketRef.current;
}
