import { create } from 'zustand';
import { AgentLiveState, AgentSourceType } from '../types/agent';

interface AgentStore {
    agents: Map<string, AgentLiveState>;
    activeView: 'dashboard' | 'pixel' | 'timeline';
    selectedAgentId: string | null;

    connected: boolean;
    reconnecting: boolean;

    sourceFilter: AgentSourceType[];
    teamFilter: string[];
    statusFilter: string[];

    setAgent: (state: AgentLiveState) => void;
    removeAgent: (id: string) => void;
    selectAgent: (id: string | null) => void;
    setView: (view: 'dashboard' | 'pixel' | 'timeline') => void;
    setConnectionStatus: (connected: boolean, reconnecting?: boolean) => void;
    setFilters: (filters: Partial<Pick<AgentStore, 'sourceFilter' | 'teamFilter' | 'statusFilter'>>) => void;
    initSession: (agents: AgentLiveState[]) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
    agents: new Map(),
    activeView: 'dashboard',
    selectedAgentId: null,

    connected: false,
    reconnecting: false,

    sourceFilter: [],
    teamFilter: [],
    statusFilter: [],

    setAgent: (state) => set((s) => {
        const newAgents = new Map(s.agents);
        newAgents.set(state.agent_id, state);
        return { agents: newAgents };
    }),

    removeAgent: (id) => set((s) => {
        const newAgents = new Map(s.agents);
        newAgents.delete(id);
        return { agents: newAgents };
    }),

    selectAgent: (id) => set({ selectedAgentId: id }),
    setView: (view) => set({ activeView: view }),
    setConnectionStatus: (connected, reconnecting = false) => set({ connected, reconnecting }),
    setFilters: (filters) => set((s) => ({ ...s, ...filters })),

    initSession: (agentsList) => set(() => {
        const newMap = new Map<string, AgentLiveState>();
        agentsList.forEach(a => newMap.set(a.agent_id, a));
        return { agents: newMap };
    })
}));
