import { create } from 'zustand';

export type MissionControlQueryKey =
  | 'tasks'
  | 'taskComments'
  | 'goals'
  | 'summary'
  | 'activities'
  | 'notifications';

interface MissionControlStore {
  versions: Record<MissionControlQueryKey, number>;
  bump: (keys: MissionControlQueryKey | MissionControlQueryKey[]) => void;
}

const INITIAL_VERSIONS: Record<MissionControlQueryKey, number> = {
  tasks: 0,
  taskComments: 0,
  goals: 0,
  summary: 0,
  activities: 0,
  notifications: 0,
};

export const useMissionControlStore = create<MissionControlStore>((set) => ({
  versions: INITIAL_VERSIONS,
  bump: (keys) => set((state) => {
    const next = { ...state.versions };
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      next[key] += 1;
    }
    return { versions: next };
  }),
}));
