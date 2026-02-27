import { useActivityFeed } from '../../hooks/useActivityFeed';
import { ActivityFeedItem } from './ActivityFeedItem';
import { ActivityFeedFilters } from './ActivityFeedFilters';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Button } from '../../components/ui/button';
import { ActivityFeedSkeleton } from '../../components/ui/skeleton';
import { Pause, Play, Trash2, Filter } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { useAgentStore } from '../../stores/agentStore';

export function ActivityFeed() {
    const {
        events,
        isPaused,
        togglePause,
        clearFeed,
        agentFilter,
        setAgentFilter,
        typeFilters,
        setTypeFilters
    } = useActivityFeed();
    const { connected } = useAgentStore();

    const [filtersOpen, setFiltersOpen] = useState(false);
    const activeFilterCount = (agentFilter ? 1 : 0) + (typeFilters.length > 0 ? 1 : 0);

    // 화면 바탕 스크롤 시 필터 팝업 모달이 화면을 따라다니는 문제 해결
    useEffect(() => {
        if (!filtersOpen) return;
        const handleScroll = (e: Event) => {
            // 팝업 내부의 스크롤은 무시
            if (e.target instanceof Element && e.target.closest('[data-radix-popper-content-wrapper]')) return;
            setFiltersOpen(false);
        };
        window.addEventListener('scroll', handleScroll, { passive: true, capture: true });
        return () => window.removeEventListener('scroll', handleScroll, { capture: true });
    }, [filtersOpen]);

    return (
        <div className="flex flex-col h-full overflow-hidden relative">
            {/* Feed Controls */}
            <div className="flex justify-between flex-wrap gap-2 items-center mb-2 px-1">
                <div className="text-xs text-slate-400">
                    Showing {events.length} events {isPaused && <span className="text-amber-500 font-medium ml-1">(Paused)</span>}
                </div>
                <div className="flex gap-1 items-center">
                    <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 relative text-slate-400 hover:text-slate-200" title="Filters">
                                <Filter className="h-4 w-4" />
                                {activeFilterCount > 0 && (
                                    <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-blue-500" />
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 bg-slate-800 border-slate-700" align="end">
                            <ActivityFeedFilters
                                agentFilter={agentFilter}
                                setAgentFilter={setAgentFilter}
                                typeFilters={typeFilters}
                                setTypeFilters={setTypeFilters}
                            />
                        </PopoverContent>
                    </Popover>
                    <div className="w-px h-4 bg-slate-700 mx-1" />
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
                    {!connected && events.length === 0 ? (
                        <ActivityFeedSkeleton />
                    ) : events.length === 0 ? (
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
