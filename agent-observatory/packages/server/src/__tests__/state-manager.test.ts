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

  describe('getHierarchy()', () => {
    it('should return empty array when no agents exist', () => {
      const sm = new StateManager();
      expect(sm.getHierarchy()).toEqual([]);
    });

    it('should return single root agent with no children', () => {
      const sm = new StateManager();
      sm.handleEvent(makeSessionStart('root-1', 'sess-1'));

      const hierarchy = sm.getHierarchy();
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].agent.agent_id).toBe('root-1');
      expect(hierarchy[0].children).toEqual([]);
    });

    it('should return nested tree for parent-child relationship', () => {
      const sm = new StateManager();
      // Create parent agent
      sm.handleEvent(makeSessionStart('parent-1', 'sess-p1'));
      // Parent spawns a child
      sm.handleEvent(
        makeEvent({
          type: 'subagent.spawn',
          agent_id: 'parent-1',
          data: { child_agent_id: 'child-1' },
        }),
      );
      // Create child agent with parent_agent_id
      sm.handleEvent(
        makeSessionStart('child-1', 'sess-c1', {
          data: { parent_agent_id: 'parent-1' },
        }),
      );

      const hierarchy = sm.getHierarchy();
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].agent.agent_id).toBe('parent-1');
      expect(hierarchy[0].children).toHaveLength(1);
      expect(hierarchy[0].children[0].agent.agent_id).toBe('child-1');
      expect(hierarchy[0].children[0].children).toEqual([]);
    });

    it('should return correct tree for multi-level hierarchy (grandchild)', () => {
      const sm = new StateManager();
      // Create root
      sm.handleEvent(makeSessionStart('root', 'sess-r'));
      // Root spawns child
      sm.handleEvent(
        makeEvent({
          type: 'subagent.spawn',
          agent_id: 'root',
          data: { child_agent_id: 'child' },
        }),
      );
      // Create child with parent
      sm.handleEvent(
        makeSessionStart('child', 'sess-c', {
          data: { parent_agent_id: 'root' },
        }),
      );
      // Child spawns grandchild
      sm.handleEvent(
        makeEvent({
          type: 'subagent.spawn',
          agent_id: 'child',
          data: { child_agent_id: 'grandchild' },
        }),
      );
      // Create grandchild with parent
      sm.handleEvent(
        makeSessionStart('grandchild', 'sess-gc', {
          data: { parent_agent_id: 'child' },
        }),
      );

      const hierarchy = sm.getHierarchy();
      expect(hierarchy).toHaveLength(1);
      expect(hierarchy[0].agent.agent_id).toBe('root');
      expect(hierarchy[0].children).toHaveLength(1);
      expect(hierarchy[0].children[0].agent.agent_id).toBe('child');
      expect(hierarchy[0].children[0].children).toHaveLength(1);
      expect(hierarchy[0].children[0].children[0].agent.agent_id).toBe('grandchild');
      expect(hierarchy[0].children[0].children[0].children).toEqual([]);
    });
  });

  describe('getSubtree()', () => {
    it('should return subtree for an existing agent', () => {
      const sm = new StateManager();
      sm.handleEvent(makeSessionStart('parent', 'sess-p'));
      sm.handleEvent(
        makeEvent({
          type: 'subagent.spawn',
          agent_id: 'parent',
          data: { child_agent_id: 'child' },
        }),
      );
      sm.handleEvent(
        makeSessionStart('child', 'sess-c', {
          data: { parent_agent_id: 'parent' },
        }),
      );

      const subtree = sm.getSubtree('parent');
      expect(subtree).toBeDefined();
      expect(subtree!.agent.agent_id).toBe('parent');
      expect(subtree!.children).toHaveLength(1);
      expect(subtree!.children[0].agent.agent_id).toBe('child');
    });

    it('should return undefined for non-existing agent', () => {
      const sm = new StateManager();
      expect(sm.getSubtree('non-existent')).toBeUndefined();
    });
  });

  describe('getTeams()', () => {
    it('should return agents grouped by team', () => {
      const sm = new StateManager();
      sm.handleEvent(makeSessionStart('a1', 's1', { team_id: 'team-alpha' }));
      sm.handleEvent(makeSessionStart('a2', 's2', { team_id: 'team-alpha' }));
      sm.handleEvent(makeSessionStart('a3', 's3', { team_id: 'team-beta' }));

      const teams = sm.getTeams();
      expect(teams).toHaveLength(2);

      const alpha = teams.find((t) => t.team_id === 'team-alpha');
      const beta = teams.find((t) => t.team_id === 'team-beta');

      expect(alpha).toBeDefined();
      expect(alpha!.agents).toHaveLength(2);
      expect(alpha!.agents.map((a) => a.agent_id).sort()).toEqual(['a1', 'a2']);

      expect(beta).toBeDefined();
      expect(beta!.agents).toHaveLength(1);
      expect(beta!.agents[0].agent_id).toBe('a3');
    });

    it('should group agents without team_id under "Ungrouped"', () => {
      const sm = new StateManager();
      sm.handleEvent(makeSessionStart('a1', 's1', { team_id: 'team-alpha' }));
      sm.handleEvent(makeSessionStart('a2', 's2')); // no team_id

      const teams = sm.getTeams();
      expect(teams).toHaveLength(2);

      const alpha = teams.find((t) => t.team_id === 'team-alpha');
      const ungrouped = teams.find((t) => t.team_id === 'Ungrouped');

      expect(alpha).toBeDefined();
      expect(alpha!.agents).toHaveLength(1);
      expect(alpha!.agents[0].agent_id).toBe('a1');

      expect(ungrouped).toBeDefined();
      expect(ungrouped!.agents).toHaveLength(1);
      expect(ungrouped!.agents[0].agent_id).toBe('a2');
    });
  });
});
