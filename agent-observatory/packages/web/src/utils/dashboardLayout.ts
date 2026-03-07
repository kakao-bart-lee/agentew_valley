export type DashboardLayoutMode = 'focus' | 'classic';
export type DashboardFocusPane = 'metrics' | 'cost';
export type DashboardGroupingMode = 'workstream' | 'repo' | 'runtime' | 'team';

export const DEFAULT_DASHBOARD_LAYOUT_MODE: DashboardLayoutMode = 'focus';
export const DEFAULT_DASHBOARD_FOCUS_PANE: DashboardFocusPane = 'metrics';
export const DEFAULT_DASHBOARD_GROUPING_MODE: DashboardGroupingMode = 'workstream';

const DASHBOARD_LAYOUT_PARAM = 'liveLayout';
const DASHBOARD_FOCUS_PANE_PARAM = 'focusPane';
const DASHBOARD_GROUPING_MODE_PARAM = 'groupBy';

function parseDashboardLayoutMode(value: string | null | undefined): DashboardLayoutMode {
    return value === 'classic' ? 'classic' : 'focus';
}

function parseDashboardFocusPane(value: string | null | undefined): DashboardFocusPane {
    return value === 'cost' ? 'cost' : 'metrics';
}

function parseDashboardGroupingMode(value: string | null | undefined): DashboardGroupingMode {
    switch (value) {
        case 'repo':
        case 'runtime':
        case 'team':
            return value;
        default:
            return 'workstream';
    }
}

export function readDashboardLayoutMode(search: string): DashboardLayoutMode {
    return parseDashboardLayoutMode(new URLSearchParams(search).get(DASHBOARD_LAYOUT_PARAM));
}

export function readDashboardFocusPane(search: string): DashboardFocusPane {
    return parseDashboardFocusPane(new URLSearchParams(search).get(DASHBOARD_FOCUS_PANE_PARAM));
}

export function readDashboardGroupingMode(search: string): DashboardGroupingMode {
    return parseDashboardGroupingMode(new URLSearchParams(search).get(DASHBOARD_GROUPING_MODE_PARAM));
}

export function writeDashboardLayoutMode(search: string, mode: DashboardLayoutMode): string {
    const params = new URLSearchParams(search);

    if (mode === DEFAULT_DASHBOARD_LAYOUT_MODE) {
        params.delete(DASHBOARD_LAYOUT_PARAM);
    } else {
        params.set(DASHBOARD_LAYOUT_PARAM, mode);
    }

    const next = params.toString();
    return next ? `?${next}` : '';
}

export function writeDashboardFocusPane(search: string, pane: DashboardFocusPane): string {
    const params = new URLSearchParams(search);

    if (pane === DEFAULT_DASHBOARD_FOCUS_PANE) {
        params.delete(DASHBOARD_FOCUS_PANE_PARAM);
    } else {
        params.set(DASHBOARD_FOCUS_PANE_PARAM, pane);
    }

    const next = params.toString();
    return next ? `?${next}` : '';
}

export function writeDashboardGroupingMode(search: string, mode: DashboardGroupingMode): string {
    const params = new URLSearchParams(search);

    if (mode === DEFAULT_DASHBOARD_GROUPING_MODE) {
        params.delete(DASHBOARD_GROUPING_MODE_PARAM);
    } else {
        params.set(DASHBOARD_GROUPING_MODE_PARAM, mode);
    }

    const next = params.toString();
    return next ? `?${next}` : '';
}
