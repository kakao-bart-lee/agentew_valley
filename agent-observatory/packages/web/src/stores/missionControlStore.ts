import { create } from 'zustand';

export type MissionControlQueryKey =
  | 'tasks'
  | 'taskComments'
  | 'goals'
  | 'summary'
  | 'activities'
  | 'notifications'
  | 'approvals'
  | 'adapters';

export type MissionControlTab =
  | 'tasks'
  | 'migration'
  | 'activity'
  | 'notifications'
  | 'approvals'
  | 'adapters';

interface MissionControlStore {
  versions: Record<MissionControlQueryKey, number>;
  activeTab: MissionControlTab;
  selectedTaskId: string | null;
  selectedApprovalId: string | null;
  bump: (keys: MissionControlQueryKey | MissionControlQueryKey[]) => void;
  setActiveTab: (tab: MissionControlTab) => void;
  selectTask: (taskId: string | null) => void;
  selectApproval: (approvalId: string | null) => void;
}

const INITIAL_VERSIONS: Record<MissionControlQueryKey, number> = {
  tasks: 0,
  taskComments: 0,
  goals: 0,
  summary: 0,
  activities: 0,
  notifications: 0,
  approvals: 0,
  adapters: 0,
};

export const useMissionControlStore = create<MissionControlStore>((set) => ({
  versions: INITIAL_VERSIONS,
  activeTab: 'tasks',
  selectedTaskId: null,
  selectedApprovalId: null,
  bump: (keys) => set((state) => {
    const next = { ...state.versions };
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      next[key] += 1;
    }
    return { versions: next };
  }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
  selectApproval: (approvalId) => set({ selectedApprovalId: approvalId }),
}));
