import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn('animate-pulse rounded-md bg-slate-700/60', className)}
            {...props}
        />
    );
}

export function AgentCardSkeleton() {
    return (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between">
                <div className="flex flex-col gap-2 flex-1">
                    <div className="flex gap-2">
                        <Skeleton className="h-4 w-8 rounded-full" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-5 w-40" />
                </div>
                <Skeleton className="h-3 w-3 rounded-full shrink-0" />
            </div>
            <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-24" />
                <div className="flex gap-4 mt-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3 w-12" />
                </div>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-700/50">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-20" />
            </div>
        </div>
    );
}

export function ActivityFeedSkeleton() {
    return (
        <div className="flex flex-col divide-y divide-slate-700/50">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2.5">
                    <Skeleton className="h-3 w-14 mt-1" />
                    <Skeleton className="h-5 w-7 rounded-full shrink-0" />
                    <Skeleton className="h-4 w-24 shrink-0" />
                    <Skeleton className="h-4 flex-1" />
                </div>
            ))}
        </div>
    );
}
