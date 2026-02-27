import { useState, useCallback, useEffect } from 'react';
import { UAEPEvent, UAEPEventType } from '../types/uaep';
import { useSocket } from './useSocket';

export function useActivityFeed() {
    const socket = useSocket();
    const [events, setEvents] = useState<UAEPEvent[]>([]);
    const [isPaused, setIsPaused] = useState(false);
    const [agentFilter, setAgentFilter] = useState<string | null>(null);
    const [typeFilters, setTypeFilters] = useState<UAEPEventType[]>([]);

    // Function to listen for incoming events
    useEffect(() => {
        if (!socket) return;

        const handleNewEvent = (newEvent: UAEPEvent) => {
            if (isPaused) return;

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
    }, [socket, isPaused]);

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
