import { describe, it, expect, vi } from 'vitest';
import { StateManager } from '../core/state-manager.js';
import {
  makeSessionStart,
  makeToolStart,
  makeToolEnd,
  makeSessionEnd,
  makeMetricsUsage,
  makeEvent,
} from './helpers.js';

describe('StateManager', () => {
  it('should create agent on session.start with status idle', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart('agent-1', 'sess-1'));

    const agent = sm.getAgent('agent-1');
    expect(agent).toBeDefined();
    expect(agent!.status).toBe('idle');
    expect(agent!.agent_id).toBe('agent-1');
    expect(agent!.session_id).toBe('sess-1');
    expect(agent!.total_tool_calls).toBe(0);
    expect(agent!.total_tokens).toBe(0);
    expect(agent!.child_agent_ids).toEqual([]);
  });

  it('should set status to acting and current_tool on tool.start', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());

    const spanId = 'span-1';
    sm.handleEvent(makeToolStart('Read', 'agent-1', spanId));

    const agent = sm.getAgent('agent-1')!;
    expect(agent.status).toBe('acting');
    expect(agent.current_tool).toBe('Read');
    expect(agent.current_tool_category).toBe('file_read');
    expect(agent.total_tool_calls).toBe(1);
  });

  it('should set status to idle on tool.end (last tool)', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());

    const spanId = 'span-100';
    sm.handleEvent(makeToolStart('Read', 'agent-1', spanId));
    sm.handleEvent(makeToolEnd('agent-1', spanId));

    const agent = sm.getAgent('agent-1')!;
    expect(agent.status).toBe('idle');
    expect(agent.current_tool).toBeUndefined();
    expect(agent.current_tool_category).toBeUndefined();
    expect(agent.tool_distribution.file_read).toBe(1);
  });

  it('should remove agent and call onRemove on session.end', () => {
    const sm = new StateManager();
    const removeHandler = vi.fn();
    sm.onRemove(removeHandler);

    sm.handleEvent(makeSessionStart());
    expect(sm.getAgent('agent-1')).toBeDefined();

    sm.handleEvent(makeSessionEnd());
    expect(sm.getAgent('agent-1')).toBeUndefined();
    expect(removeHandler).toHaveBeenCalledWith('agent-1');
  });

  it('should add child_agent_id on subagent.spawn', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());

    sm.handleEvent(
      makeEvent({
        type: 'subagent.spawn',
        agent_id: 'agent-1',
        data: { child_agent_id: 'child-1' },
      }),
    );

    const agent = sm.getAgent('agent-1')!;
    expect(agent.child_agent_ids).toContain('child-1');
  });

  it('should remove child_agent_id on subagent.end', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());

    sm.handleEvent(
      makeEvent({
        type: 'subagent.spawn',
        agent_id: 'agent-1',
        data: { child_agent_id: 'child-1' },
      }),
    );
    sm.handleEvent(
      makeEvent({
        type: 'subagent.end',
        agent_id: 'agent-1',
        data: { child_agent_id: 'child-1' },
      }),
    );

    const agent = sm.getAgent('agent-1')!;
    expect(agent.child_agent_ids).not.toContain('child-1');
  });

  it('should update tokens and cost on metrics.usage', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());

    sm.handleEvent(makeMetricsUsage(1000, 0.05));
    sm.handleEvent(makeMetricsUsage(500, 0.025));

    const agent = sm.getAgent('agent-1')!;
    expect(agent.total_tokens).toBe(1500);
    expect(agent.total_cost_usd).toBeCloseTo(0.075);
  });

  it('should set status to waiting_permission on user.permission', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());
    sm.handleEvent(makeEvent({ type: 'user.permission' }));

    expect(sm.getAgent('agent-1')!.status).toBe('waiting_permission');
  });

  it('should set status to thinking on user.input', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());
    sm.handleEvent(makeEvent({ type: 'user.input' }));

    expect(sm.getAgent('agent-1')!.status).toBe('thinking');
  });

  it('should manage multiple agents independently', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart('agent-1', 'sess-1'));
    sm.handleEvent(makeSessionStart('agent-2', 'sess-2'));

    sm.handleEvent(makeToolStart('Bash', 'agent-1', 'span-a'));
    sm.handleEvent(makeToolStart('Read', 'agent-2', 'span-b'));

    expect(sm.getAgent('agent-1')!.current_tool).toBe('Bash');
    expect(sm.getAgent('agent-2')!.current_tool).toBe('Read');
    expect(sm.getAllAgents()).toHaveLength(2);
  });

  it('should call onChange handler on state updates', () => {
    const sm = new StateManager();
    const changeHandler = vi.fn();
    sm.onChange(changeHandler);

    sm.handleEvent(makeSessionStart());
    expect(changeHandler).toHaveBeenCalledTimes(1);
    expect(changeHandler.mock.calls[0][0].agent_id).toBe('agent-1');
  });

  it('should increment total_errors on tool.error', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart());
    sm.handleEvent(makeEvent({ type: 'tool.error', data: { error: 'File not found' } }));

    expect(sm.getAgent('agent-1')!.total_errors).toBe(1);
    expect(sm.getAgent('agent-1')!.status_detail).toBe('File not found');
  });

  it('should filter agents by team with getAgentsByTeam', () => {
    const sm = new StateManager();
    sm.handleEvent(makeSessionStart('a1', 's1', { team_id: 'team-x' }));
    sm.handleEvent(makeSessionStart('a2', 's2', { team_id: 'team-x' }));
    sm.handleEvent(makeSessionStart('a3', 's3', { team_id: 'team-y' }));

    expect(sm.getAgentsByTeam('team-x')).toHaveLength(2);
    expect(sm.getAgentsByTeam('team-y')).toHaveLength(1);
  });
});
