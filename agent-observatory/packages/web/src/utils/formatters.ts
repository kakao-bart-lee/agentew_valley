import { formatDistanceToNow, parseISO } from 'date-fns';

export function formatLargeNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
    }).format(amount);
}

export function formatRelativeTime(isoString: string): string {
    try {
        return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
    } catch (e) {
        return 'unknown';
    }
}
