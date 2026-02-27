import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityFeedItem } from '../views/Dashboard/ActivityFeedItem';
import type { UAEPEvent } from '../types/uaep';

const makeEvent = (overrides: Partial<UAEPEvent> = {}): UAEPEvent => ({
    event_id: 'evt-1',
    type: 'session.start',
    agent_id: 'agent-1',
    agent_name: 'Test Agent',
    source: 'claude_code',
    ts: new Date('2024-01-01T12:30:45Z').toISOString(),
    data: {},
    ...overrides,
});

describe('ActivityFeedItem', () => {
    it('에이전트 이름 표시', () => {
        render(<ActivityFeedItem event={makeEvent({ agent_name: 'My Agent' })} />);
        expect(screen.getByText('My Agent')).toBeInTheDocument();
    });

    it('시간 포맷 표시 (HH:MM:SS)', () => {
        render(<ActivityFeedItem event={makeEvent({ ts: new Date('2024-01-01T12:30:45Z').toISOString() })} />);
        // UTC 오프셋에 관계없이 패턴 확인
        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    });

    it('session.start 이벤트 렌더링', () => {
        render(<ActivityFeedItem event={makeEvent({ type: 'session.start' })} />);
        expect(screen.getByText(/Session started/)).toBeInTheDocument();
    });

    it('session.end 이벤트 렌더링', () => {
        render(<ActivityFeedItem event={makeEvent({ type: 'session.end' })} />);
        expect(screen.getByText(/Session ended/)).toBeInTheDocument();
    });

    it('user.input 이벤트 렌더링', () => {
        render(<ActivityFeedItem event={makeEvent({ type: 'user.input' })} />);
        expect(screen.getByText(/User input/)).toBeInTheDocument();
    });

    it('tool.start 이벤트 — 도구명 표시', () => {
        render(<ActivityFeedItem event={makeEvent({
            type: 'tool.start',
            data: { tool_name: 'ReadFile', tool_category: 'file_read' },
        })} />);
        expect(screen.getByText(/ReadFile/)).toBeInTheDocument();
    });

    it('tool.end 성공 이벤트 — 체크 표시', () => {
        render(<ActivityFeedItem event={makeEvent({
            type: 'tool.end',
            data: { tool_name: 'ReadFile', success: true, duration_ms: 42 },
        })} />);
        expect(screen.getByText('✓')).toBeInTheDocument();
        expect(screen.getByText(/42ms/)).toBeInTheDocument();
    });

    it('tool.end 실패 이벤트 — X 표시', () => {
        render(<ActivityFeedItem event={makeEvent({
            type: 'tool.end',
            data: { tool_name: 'ReadFile', success: false, duration_ms: 10 },
        })} />);
        expect(screen.getByText('✗')).toBeInTheDocument();
    });

    it('tool.error 이벤트 — 에러 메시지 표시', () => {
        render(<ActivityFeedItem event={makeEvent({
            type: 'tool.error',
            data: { tool_name: 'Bash', error_message: 'Permission denied' },
        })} />);
        expect(screen.getByText(/Permission denied/)).toBeInTheDocument();
    });

    it('agent.status 이벤트 — 상태 표시', () => {
        render(<ActivityFeedItem event={makeEvent({
            type: 'agent.status',
            data: { status: 'thinking' },
        })} />);
        expect(screen.getByText(/Status: thinking/)).toBeInTheDocument();
    });

    it('subagent.spawn 이벤트 — 하위 에이전트 이름 표시', () => {
        render(<ActivityFeedItem event={makeEvent({
            type: 'subagent.spawn',
            data: { child_agent_name: 'Worker Agent' },
        })} />);
        expect(screen.getByText(/Spawned: Worker Agent/)).toBeInTheDocument();
    });

    it('알 수 없는 이벤트 타입 처리', () => {
        render(<ActivityFeedItem event={makeEvent({ type: 'unknown.event' as any })} />);
        expect(screen.getByText(/Unknown event/)).toBeInTheDocument();
    });
});
