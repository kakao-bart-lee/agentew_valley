import { create } from 'zustand';
import { MetricsSnapshot } from '../types/metrics';

interface MetricsStore {
    snapshot: MetricsSnapshot | null;
    setSnapshot: (snapshot: MetricsSnapshot) => void;
}

export const useMetricsStore = create<MetricsStore>((set) => ({
    snapshot: null,
    setSnapshot: (snapshot) => set({ snapshot }),
}));
