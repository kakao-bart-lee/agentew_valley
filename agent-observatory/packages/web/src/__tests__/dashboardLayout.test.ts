import { describe, expect, it } from 'vitest';
import {
    readDashboardFocusPane,
    readDashboardGroupingMode,
    readDashboardLayoutMode,
    writeDashboardFocusPane,
    writeDashboardGroupingMode,
    writeDashboardLayoutMode,
} from '../utils/dashboardLayout';

describe('dashboardLayout', () => {
    it('defaults to focus layout, metrics pane, and workstream grouping', () => {
        expect(readDashboardLayoutMode('')).toBe('focus');
        expect(readDashboardFocusPane('')).toBe('metrics');
        expect(readDashboardGroupingMode('')).toBe('workstream');
    });

    it('reads supported query param values', () => {
        expect(readDashboardLayoutMode('?liveLayout=classic')).toBe('classic');
        expect(readDashboardFocusPane('?focusPane=cost')).toBe('cost');
        expect(readDashboardGroupingMode('?groupBy=runtime')).toBe('runtime');
    });

    it('writes classic mode while keeping other params intact', () => {
        expect(writeDashboardLayoutMode('?foo=bar', 'classic')).toBe('?foo=bar&liveLayout=classic');
    });

    it('removes params when writing defaults', () => {
        expect(writeDashboardLayoutMode('?liveLayout=classic&foo=bar', 'focus')).toBe('?foo=bar');
        expect(writeDashboardFocusPane('?focusPane=cost&foo=bar', 'metrics')).toBe('?foo=bar');
        expect(writeDashboardGroupingMode('?groupBy=team&foo=bar', 'workstream')).toBe('?foo=bar');
    });

    it('writes grouping mode while keeping other params intact', () => {
        expect(writeDashboardGroupingMode('?foo=bar', 'repo')).toBe('?foo=bar&groupBy=repo');
    });
});
