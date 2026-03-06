import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../stores/agentStore';
import type { AgentLiveState } from '../types/agent';

const makeAgent = (id: string, overrides: Partial<AgentLiveState> = {}): AgentLiveState => ({
    agent_id: id,
    agent_name: `Agent ${id}`,
    source: 'claude_code',
    status: 'idle',
    last_activity: new Date().toISOString(),
    session_id: `session-${id}`,
    session_start: new Date().toISOString(),
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_cost_usd: 0,
    total_tool_calls: 0,
    total_errors: 0,
    health_status: 'normal',
    llm_response_count: 0,
    llm_total_text_length: 0,
    tool_distribution: {
        file_read: 0, file_write: 0, command: 0, search: 0,
        web: 0, planning: 0, thinking: 0, communication: 0, other: 0,
    },
    child_agent_ids: [],
    ...overrides,
});

describe('agentStore', () => {
    beforeEach(() => {
        useAgentStore.setState({
            agents: new Map(),
            selectedAgentId: null,
            activeView: 'overview',
            connected: false,
            reconnecting: false,
            sourceFilter: [],
            teamFilter: [],
            statusFilter: [],
        });
    });

    describe('setAgent', () => {
        it('새 에이전트를 Map에 추가', () => {
            const agent = makeAgent('a1');
            useAgentStore.getState().setAgent(agent);

            const { agents } = useAgentStore.getState();
            expect(agents.size).toBe(1);
            expect(agents.get('a1')).toEqual(agent);
        });

        it('같은 ID면 기존 항목을 덮어씀', () => {
            useAgentStore.getState().setAgent(makeAgent('a1', { status: 'idle' }));
            useAgentStore.getState().setAgent(makeAgent('a1', { status: 'acting' }));

            const { agents } = useAgentStore.getState();
            expect(agents.size).toBe(1);
            expect(agents.get('a1')?.status).toBe('acting');
        });

        it('여러 에이전트를 개별 추가', () => {
            useAgentStore.getState().setAgent(makeAgent('a1'));
            useAgentStore.getState().setAgent(makeAgent('a2'));
            useAgentStore.getState().setAgent(makeAgent('a3'));

            expect(useAgentStore.getState().agents.size).toBe(3);
        });
    });

    describe('removeAgent', () => {
        it('존재하는 에이전트를 삭제', () => {
            useAgentStore.getState().setAgent(makeAgent('a1'));
            useAgentStore.getState().setAgent(makeAgent('a2'));

            useAgentStore.getState().removeAgent('a1');

            const { agents } = useAgentStore.getState();
            expect(agents.size).toBe(1);
            expect(agents.has('a1')).toBe(false);
            expect(agents.has('a2')).toBe(true);
        });

        it('존재하지 않는 ID를 삭제해도 오류 없음', () => {
            expect(() => {
                useAgentStore.getState().removeAgent('nonexistent');
            }).not.toThrow();
        });
    });

    describe('initSession', () => {
        it('에이전트 목록으로 Map 초기화', () => {
            useAgentStore.getState().setAgent(makeAgent('old'));

            const newAgents = [makeAgent('n1'), makeAgent('n2')];
            useAgentStore.getState().initSession(newAgents);

            const { agents } = useAgentStore.getState();
            expect(agents.size).toBe(2);
            expect(agents.has('old')).toBe(false);
            expect(agents.has('n1')).toBe(true);
            expect(agents.has('n2')).toBe(true);
        });

        it('빈 배열로 초기화 시 Map이 비워짐', () => {
            useAgentStore.getState().setAgent(makeAgent('a1'));
            useAgentStore.getState().initSession([]);

            expect(useAgentStore.getState().agents.size).toBe(0);
        });
    });

    describe('setFilters', () => {
        it('sourceFilter 업데이트', () => {
            useAgentStore.getState().setFilters({ sourceFilter: ['claude_code'] });
            expect(useAgentStore.getState().sourceFilter).toEqual(['claude_code']);
        });

        it('부분 업데이트 — 다른 필터 유지', () => {
            useAgentStore.getState().setFilters({ statusFilter: ['acting'] });
            useAgentStore.getState().setFilters({ sourceFilter: ['claude_code'] });

            const { statusFilter, sourceFilter } = useAgentStore.getState();
            expect(statusFilter).toEqual(['acting']);
            expect(sourceFilter).toEqual(['claude_code']);
        });
    });

    describe('selectAgent', () => {
        it('선택 에이전트 ID 설정', () => {
            useAgentStore.getState().selectAgent('a1');
            expect(useAgentStore.getState().selectedAgentId).toBe('a1');
        });

        it('null로 선택 해제', () => {
            useAgentStore.getState().selectAgent('a1');
            useAgentStore.getState().selectAgent(null);
            expect(useAgentStore.getState().selectedAgentId).toBeNull();
        });
    });

    describe('setView', () => {
        it('top-level domain view를 전환한다', () => {
            useAgentStore.getState().setView('control');
            expect(useAgentStore.getState().activeView).toBe('control');
        });
    });

    describe('setConnectionStatus', () => {
        it('connected 상태 업데이트', () => {
            useAgentStore.getState().setConnectionStatus(true);
            expect(useAgentStore.getState().connected).toBe(true);
            expect(useAgentStore.getState().reconnecting).toBe(false);
        });

        it('reconnecting 함께 업데이트', () => {
            useAgentStore.getState().setConnectionStatus(false, true);
            expect(useAgentStore.getState().connected).toBe(false);
            expect(useAgentStore.getState().reconnecting).toBe(true);
        });
    });
});
