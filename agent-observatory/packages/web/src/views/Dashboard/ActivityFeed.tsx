import React from 'react';
import { useActivityFeed } from '../../hooks/useActivityFeed';
import { ActivityFeedItem } from './ActivityFeedItem';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Button } from '../../components/ui/button';
import { Pause, Play, Trash2 } from 'lucide-react';

export function ActivityFeed() {
    const { events, isPaused, togglePause, clearFeed } = useActivityFeed();

    return (
        <div className="flex flex-col h-full overflow-hidden relative">

            {/* Feed Controls */}
            <div className="flex justify-between flex-wrap gap-2 items-center mb-2 px-1">
                <div className="text-xs text-slate-400">
                    Showing {events.length} events {isPaused && <span className="text-amber-500 font-medium ml-1">(Paused)</span>}
                </div>
                <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-200" onClick={togglePause} title={isPaused ? "Resume feed" : "Pause feed"}>
                        {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-400" onClick={clearFeed} title="Clear feed">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <ScrollArea className="flex-1 bg-slate-900/50 rounded-md border border-slate-700/50 relative">
                <div className="flex flex-col">
                    {events.length === 0 ? (
                        <div className="text-slate-500 text-center py-8 text-sm">
                            No recent activity.
                        </div>
                    ) : (
                        events.map((evt) => (
                            <ActivityFeedItem key={evt.event_id} event={evt} />
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
