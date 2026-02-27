import { useState, useCallback, useEffect, useRef } from 'react';
import { UAEPEvent, UAEPEventType } from '../types/uaep';
import { useSocket } from './useSocket';

export function useActivityFeed() {
    const { socket } = useSocket();
    const [events, setEvents] = useState<UAEPEvent[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    // ref로 관리해 리스너 재등록 없이 항상 최신 isPaused 값을 읽음
    const isPausedRef = useRef(isPaused);
    const [agentFilter, setAgentFilter] = useState<string | null>(null);
    const [typeFilters, setTypeFilters] = useState<UAEPEventType[]>([]);

    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    // 소켓이 교체될 때만 리스너 재등록 — isPaused 변경 시 재등록 불필요
    useEffect(() => {
        if (!socket) return;

        const handleNewEvent = (newEvent: UAEPEvent) => {
            if (isPausedRef.current) return;

            setEvents((prev) => {
                const buffered = [newEvent, ...prev];
                if (buffered.length > 200) {
                    buffered.pop(); // Keep max 200 items memory
                }
                return buffered;
            });
        };

        socket.on('event', handleNewEvent);

        return () => {
            socket.off('event', handleNewEvent);
        };
    }, [socket]);

    // Derived filtered events
    const filteredEvents = events.filter((e) => {
        if (agentFilter && e.agent_id !== agentFilter) return false;
        if (typeFilters.length > 0 && !typeFilters.includes(e.type)) return false;
        return true;
    });

    const clearFeed = useCallback(() => setEvents([]), []);
    const togglePause = useCallback(() => setIsPaused((prev) => !prev), []);

    return {
        events: filteredEvents,
        rawEvents: events,
        isPaused,
        togglePause,
        clearFeed,
        agentFilter,
        setAgentFilter,
        typeFilters,
        setTypeFilters
    };
}
