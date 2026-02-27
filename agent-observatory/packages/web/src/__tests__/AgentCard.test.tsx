import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentCard } from '../views/Dashboard/AgentCard';
import type { AgentLiveState } from '../types/agent';

// Tooltip은 jsdom에서 포털 렌더링 이슈가 있어 단순화
vi.mock('../components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger: ({ children, asChild: _asChild }: { children: React.ReactNode; asChild?: boolean }) => <div>{children}</div>,
    TooltipContent: () => null,
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const makeAgent = (overrides: Partial<AgentLiveState> = {}): AgentLiveState => ({
    agent_id: 'test-agent-1',
    agent_name: 'Test Agent',
    source: 'claude_code',
    status: 'idle',
    last_activity: new Date().toISOString(),
    session_id: 'session-1',
    session_start: new Date().toISOString(),
    total_tokens: 1500,
    total_cost_usd: 0.0042,
    total_tool_calls: 7,
    total_errors: 0,
    tool_distribution: {},
    child_agent_ids: [],
    ...overrides,
});

describe('AgentCard', () => {
    it('에이전트 이름 렌더링', () => {
        render(<AgentCard agent={makeAgent({ agent_name: 'My Agent' })} />);
        expect(screen.getByText('My Agent')).toBeInTheDocument();
    });

    it('소스 배지 표시', () => {
        render(<AgentCard agent={makeAgent({ source: 'claude_code' })} />);
        // SOURCE_LABELS['claude_code'] = 'CC'
        expect(screen.getByText('CC')).toBeInTheDocument();
    });

    it('상태 텍스트 표시', () => {
        render(<AgentCard agent={makeAgent({ status: 'acting' })} />);
        const statusElements = screen.getAllByText('acting');
        expect(statusElements.length).toBeGreaterThan(0);
    });

    it('토큰 수 포맷 표시', () => {
        render(<AgentCard agent={makeAgent({ total_tokens: 1500 })} />);
        expect(screen.getByText('1.5k')).toBeInTheDocument();
    });

    it('비용 포맷 표시', () => {
        render(<AgentCard agent={makeAgent({ total_cost_usd: 0.0042 })} />);
        expect(screen.getByText('$0.0042')).toBeInTheDocument();
    });

    it('도구 호출 수 표시', () => {
        render(<AgentCard agent={makeAgent({ total_tool_calls: 7 })} />);
        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('에러 없으면 에러 표시 없음', () => {
        render(<AgentCard agent={makeAgent({ total_errors: 0 })} />);
        // AlertCircle 아이콘과 함께 표시되는 에러 카운트가 없어야 함
        expect(screen.queryByText('0')).toBeNull();
    });

    it('에러 있으면 에러 카운트 표시', () => {
        render(<AgentCard agent={makeAgent({ total_errors: 3 })} />);
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('acting 상태에서 current_tool 표시', () => {
        render(<AgentCard agent={makeAgent({
            status: 'acting',
            current_tool: 'Read',
            current_tool_category: 'file_read',
        })} />);
        expect(screen.getByText(/Read/)).toBeInTheDocument();
    });

    it('acting이 아니면 current_tool 표시 안 함', () => {
        render(<AgentCard agent={makeAgent({
            status: 'idle',
            current_tool: 'Read',
        })} />);
        expect(screen.queryByText('Read')).toBeNull();
    });

    it('team_id가 있으면 팀 배지 표시', () => {
        render(<AgentCard agent={makeAgent({ team_id: 'team-alpha' })} />);
        expect(screen.getByText('Team: team-alpha')).toBeInTheDocument();
    });

    it('team_id 없으면 팀 배지 없음', () => {
        render(<AgentCard agent={makeAgent({ team_id: undefined })} />);
        expect(screen.queryByText(/Team:/)).toBeNull();
    });

    it('child_agent_ids가 있으면 Sub-agents 섹션 표시', () => {
        render(<AgentCard agent={makeAgent({ child_agent_ids: ['child-1', 'child-2'] })} />);
        expect(screen.getByText('Sub-agents (2)')).toBeInTheDocument();
    });

    it('onClick 호출 시 핸들러 실행', () => {
        const onClick = vi.fn();
        render(<AgentCard agent={makeAgent()} onClick={onClick} />);
        fireEvent.click(screen.getByText('Test Agent'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('isSelected=true 시 선택 스타일 적용', () => {
        const { container } = render(<AgentCard agent={makeAgent()} isSelected={true} />);
        const card = container.firstChild as HTMLElement;
        expect(card.className).toContain('border-indigo-500');
    });

    it('isSelected=false 시 기본 스타일 적용', () => {
        const { container } = render(<AgentCard agent={makeAgent()} isSelected={false} />);
        const card = container.firstChild as HTMLElement;
        expect(card.className).toContain('border-slate-700');
    });

    it('tool_distribution이 있으면 미니바 렌더링', () => {
        const agent = makeAgent({
            tool_distribution: { file_read: 5, command: 3 },
        });
        const { container } = render(<AgentCard agent={agent} />);
        // 높이 h-1.5인 미니바 div가 존재하는지 확인
        const miniBar = container.querySelector('.h-1\\.5');
        expect(miniBar).toBeInTheDocument();
    });

    it('tool_distribution이 비어있으면 미니바 없음', () => {
        const agent = makeAgent({ tool_distribution: {} });
        const { container } = render(<AgentCard agent={agent} />);
        const miniBar = container.querySelector('.h-1\\.5');
        expect(miniBar).toBeNull();
    });
});
