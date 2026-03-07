import type {
  AgentLiveState,
  TaskContextRef,
  UAEPEvent,
  AgentSourceType,
  ToolCategory,
} from '@agent-observatory/shared';
import { coerceTaskContext, getToolCategory, inferRuntimeDescriptor } from '@agent-observatory/shared';

interface ActiveTool {
  tool_name: string;
  category: ToolCategory;
  start_ts: string;
}

type ChangeHandler = (state: AgentLiveState) => void;
type RemoveHandler = (agentId: string) => void;

function emptyDistribution(): Record<ToolCategory, number> {
  return {
    file_read: 0,
    file_write: 0,
    command: 0,
    search: 0,
    web: 0,
    planning: 0,
    thinking: 0,
    communication: 0,
    other: 0,
  };
}

function getHealthStatus(agent: AgentLiveState): AgentLiveState['health_status'] {
  if (agent.status === 'error' || agent.last_run_status === 'error' || (agent.context_window_usage ?? 0) >= 0.95) {
    return 'error';
  }
  if ((agent.context_window_usage ?? 0) >= 0.8 || (agent.tool_call_success_rate ?? 1) < 0.75 || agent.total_errors > 0) {
    return 'caution';
  }
  return 'normal';
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function mergeTaskContext(
  current: TaskContextRef | undefined,
  incoming: TaskContextRef | undefined,
): TaskContextRef | undefined {
  if (!incoming) return current;
  return {
    ...(current ?? {}),
    ...incoming,
    provider: current?.provider ?? incoming.provider,
    project_id: current?.project_id ?? incoming.project_id,
    task_id: current?.task_id ?? incoming.task_id,
    goal_id: current?.goal_id ?? incoming.goal_id,
    issue_id: current?.issue_id ?? incoming.issue_id,
    issue_identifier: current?.issue_identifier ?? incoming.issue_identifier,
    execution_run_id: current?.execution_run_id ?? incoming.execution_run_id,
    checkout_run_id: current?.checkout_run_id ?? incoming.checkout_run_id,
    title: current?.title ?? incoming.title,
    status: current?.status ?? incoming.status,
  };
}

export class StateManager {
  private agents = new Map<string, AgentLiveState>();
  private activeTools = new Map<string, Map<string, ActiveTool>>();
  private recentToolOutcomes = new Map<string, boolean[]>();
  private changeHandlers: ChangeHandler[] = [];
  private removeHandlers: RemoveHandler[] = [];

  handleEvent(event: UAEPEvent): void {
    switch (event.type) {
      case 'session.start':
        this.handleSessionStart(event);
        break;
      case 'session.end':
        this.handleSessionEnd(event);
        break;
      case 'tool.start':
        this.handleToolStart(event);
        break;
      case 'tool.end':
        this.handleToolEnd(event);
        break;
      case 'tool.error':
        this.handleToolError(event);
        break;
      case 'agent.status':
        this.handleAgentStatus(event);
        break;
      case 'user.input':
        this.handleUserInput(event);
        break;
      case 'user.permission':
        this.handleUserPermission(event);
        break;
      case 'subagent.spawn':
        this.handleSubagentSpawn(event);
        break;
      case 'subagent.end':
        this.handleSubagentEnd(event);
        break;
      case 'metrics.usage':
        this.handleMetricsUsage(event);
        break;
      case 'llm.end':
        this.handleLlmEnd(event);
        break;
      default:
        break;
    }

    const agent = this.agents.get(event.agent_id);
    if (agent) {
      if (event.agent_name) {
        agent.agent_name = event.agent_name;
      }
      agent.project_id = agent.project_id ?? getOptionalString(event.project_id ?? event.data?.['project_id']);
      agent.task_id = agent.task_id ?? getOptionalString(event.task_id ?? event.data?.['task_id']);
      agent.goal_id = agent.goal_id ?? getOptionalString(event.goal_id ?? event.data?.['goal_id']);
      agent.runtime = {
        ...(agent.runtime ?? inferRuntimeDescriptor(event.source)),
        ...inferRuntimeDescriptor(event.source, event.runtime),
      };
      agent.task_context = mergeTaskContext(agent.task_context, coerceTaskContext(event));
      agent.last_activity = event.ts;
    }
  }

  private handleSessionStart(event: UAEPEvent): void {
    const existing = this.agents.get(event.agent_id);

    // 이미 존재하는 에이전트라면 model_id 등 누락된 필드만 보완 (데이터 유실 방지)
    if (existing) {
      if (event.agent_name) {
        existing.agent_name = event.agent_name;
      }
      if (!existing.team_id && event.team_id) {
        existing.team_id = event.team_id;
      }
      if (!existing.project_id && event.project_id) {
        existing.project_id = event.project_id;
      }
      if (!existing.model_id && event.model_id) {
        existing.model_id = event.model_id;
      }
      if (!existing.model_id && event.data?.['model_id']) {
        existing.model_id = event.data['model_id'] as string;
      }
      existing.runtime = {
        ...(existing.runtime ?? inferRuntimeDescriptor(event.source)),
        ...inferRuntimeDescriptor(event.source, event.runtime),
      };
      existing.task_context = mergeTaskContext(existing.task_context, coerceTaskContext(event));
      this.notifyChange(existing);
      return;
    }

    const state: AgentLiveState = {
      agent_id: event.agent_id,
      agent_name: event.agent_name ?? event.agent_id,
      source: event.source,
      runtime: inferRuntimeDescriptor(event.source, event.runtime),
      team_id: event.team_id,
      project_id: event.project_id,
      task_id: getOptionalString(event.task_id ?? event.data?.['task_id']),
      goal_id: getOptionalString(event.goal_id ?? event.data?.['goal_id']),
      task_context: coerceTaskContext(event),
      status: 'idle',
      last_activity: event.ts,
      session_id: event.session_id,
      session_start: event.ts,
      model_id: event.model_id ?? (event.data?.['model_id'] as string | undefined),
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_cost_usd: 0,
      total_tool_calls: 0,
      tool_call_success_rate: 1,
      recent_tool_call_count: 0,
      total_errors: 0,
      last_run_status: 'idle',
      health_status: 'normal',
      llm_response_count: 0,
      llm_total_text_length: 0,
      tool_distribution: emptyDistribution(),
      child_agent_ids: [],
    };

    if (event.data?.['parent_agent_id']) {
      state.parent_agent_id = event.data['parent_agent_id'] as string;
    }

    this.agents.set(event.agent_id, state);
    this.activeTools.set(event.agent_id, new Map());
    this.recentToolOutcomes.set(event.agent_id, []);
    this.notifyChange(state);
  }

  private handleSessionEnd(event: UAEPEvent): void {
    const agentId = event.agent_id;
    this.agents.delete(agentId);
    this.activeTools.delete(agentId);
    this.recentToolOutcomes.delete(agentId);
    this.notifyRemove(agentId);
  }

  private handleToolStart(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    const toolName = (event.data?.['tool_name'] as string) ?? 'unknown';
    const toolId = (event.span_id ?? event.event_id);
    const category = getToolCategory(toolName);

    let agentTools = this.activeTools.get(event.agent_id);
    if (!agentTools) {
      agentTools = new Map();
      this.activeTools.set(event.agent_id, agentTools);
    }
    agentTools.set(toolId, { tool_name: toolName, category, start_ts: event.ts });

    agent.status = 'acting';
    agent.current_tool = toolName;
    agent.current_tool_category = category;
    agent.total_tool_calls++;
    agent.last_run_status = 'running';

    if (event.data?.['status_detail']) {
      agent.status_detail = event.data['status_detail'] as string;
    }

    this.notifyChange(agent);
  }

  private handleToolEnd(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    const toolId = (event.span_id ?? event.event_id);
    const agentTools = this.activeTools.get(event.agent_id);

    let category: ToolCategory = 'other';
    if (agentTools) {
      const tool = agentTools.get(toolId);
      if (tool) {
        category = tool.category;
        agentTools.delete(toolId);
      }
    }

    agent.tool_distribution[category] = (agent.tool_distribution[category] ?? 0) + 1;
    agent.last_run_status = 'completed';
    this.recordToolOutcome(event.agent_id, true);

    if (!agentTools || agentTools.size === 0) {
      agent.status = 'idle';
      agent.current_tool = undefined;
      agent.current_tool_category = undefined;
      agent.status_detail = undefined;
    } else {
      const remaining = Array.from(agentTools.values());
      const last = remaining[remaining.length - 1]!;
      agent.current_tool = last.tool_name;
      agent.current_tool_category = last.category;
    }

    this.notifyChange(agent);
  }

  private handleToolError(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    agent.total_errors++;
    agent.last_run_status = 'error';
    this.recordToolOutcome(event.agent_id, false);
    if (event.data?.['error']) {
      const error = String(event.data['error']).slice(0, 200);
      agent.status_detail = error;
      agent.last_error = error;
    }

    this.notifyChange(agent);
  }

  private handleAgentStatus(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    const status = event.data?.['status'] as AgentLiveState['status'] | undefined;
    if (status) {
      agent.status = status;
    }
    if (event.data?.['status_detail'] !== undefined) {
      agent.status_detail = event.data['status_detail'] as string;
    }
    if (typeof event.data?.['context_window_usage'] === 'number') {
      agent.context_window_usage = event.data['context_window_usage'] as number;
    }
    if (status === 'waiting_permission' || status === 'waiting_input') {
      agent.last_run_status = 'waiting';
    } else if (status === 'error') {
      agent.last_run_status = 'error';
    } else if (status === 'idle') {
      agent.last_run_status = 'idle';
    }

    this.notifyChange(agent);
  }

  private handleUserInput(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    agent.status = 'thinking';
    agent.last_run_status = 'running';
    this.notifyChange(agent);
  }

  private handleUserPermission(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    agent.status = 'waiting_permission';
    agent.last_run_status = 'waiting';
    this.notifyChange(agent);
  }

  private handleSubagentSpawn(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    const childId = event.data?.['child_agent_id'] as string | undefined;
    if (childId && !agent.child_agent_ids.includes(childId)) {
      agent.child_agent_ids.push(childId);
    }

    this.notifyChange(agent);
  }

  private handleSubagentEnd(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    const childId = event.data?.['child_agent_id'] as string | undefined;
    if (childId) {
      agent.child_agent_ids = agent.child_agent_ids.filter((id) => id !== childId);
    }

    this.notifyChange(agent);
  }

  private handleMetricsUsage(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    if (typeof event.data?.['input_tokens'] === 'number') {
      agent.total_input_tokens += event.data['input_tokens'] as number;
    }
    if (typeof event.data?.['output_tokens'] === 'number') {
      agent.total_output_tokens += event.data['output_tokens'] as number;
    }
    if (typeof event.data?.['tokens'] === 'number') {
      agent.total_tokens += event.data['tokens'] as number;
    } else {
      // tokens 필드가 없으면 input + output 합산
      agent.total_tokens = agent.total_input_tokens + agent.total_output_tokens;
    }
    if (typeof event.data?.['cost'] === 'number') {
      agent.total_cost_usd += event.data['cost'] as number;
    }
    // 캐시 토큰 집계
    if (typeof event.data?.['cache_creation_input_tokens'] === 'number') {
      agent.cache_creation_tokens += event.data['cache_creation_input_tokens'] as number;
    }
    if (typeof event.data?.['cache_read_input_tokens'] === 'number') {
      agent.cache_read_tokens += event.data['cache_read_input_tokens'] as number;
    }
    // 모델 정보가 이벤트에 포함된 경우 갱신
    const modelId = event.model_id ?? (event.data?.['model_id'] as string | undefined);
    if (modelId) {
      agent.model_id = modelId;
    }
    if (typeof event.data?.['context_window_usage'] === 'number') {
      agent.context_window_usage = event.data['context_window_usage'] as number;
    }

    this.notifyChange(agent);
  }

  private handleLlmEnd(event: UAEPEvent): void {
    const agent = this.agents.get(event.agent_id);
    if (!agent) return;

    agent.llm_response_count++;
    if (typeof event.data?.['text_length'] === 'number') {
      agent.llm_total_text_length += event.data['text_length'] as number;
    }
    const modelId = event.model_id ?? (event.data?.['model_id'] as string | undefined);
    if (modelId) {
      agent.model_id = modelId;
    }

    this.notifyChange(agent);
  }

  getAgent(agentId: string): AgentLiveState | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentLiveState[] {
    return Array.from(this.agents.values());
  }

  getAgentsByTeam(teamId: string): AgentLiveState[] {
    return this.getAllAgents().filter((a) => a.team_id === teamId);
  }

  /** Get agents grouped by team */
  getTeams(): { team_id: string; agents: AgentLiveState[] }[] {
    const teamMap = new Map<string, AgentLiveState[]>();
    for (const agent of this.agents.values()) {
      const teamId = agent.team_id ?? 'Ungrouped';
      let list = teamMap.get(teamId);
      if (!list) {
        list = [];
        teamMap.set(teamId, list);
      }
      list.push(agent);
    }
    return Array.from(teamMap.entries())
      .map(([team_id, agents]) => ({ team_id, agents }));
  }

  onChange(handler: ChangeHandler): () => void {
    this.changeHandlers.push(handler);
    return () => {
      this.changeHandlers = this.changeHandlers.filter((h) => h !== handler);
    };
  }

  onRemove(handler: RemoveHandler): () => void {
    this.removeHandlers.push(handler);
    return () => {
      this.removeHandlers = this.removeHandlers.filter((h) => h !== handler);
    };
  }

  private notifyChange(state: AgentLiveState): void {
    state.health_status = getHealthStatus(state);
    for (const handler of this.changeHandlers) {
      handler(state);
    }
  }

  private notifyRemove(agentId: string): void {
    for (const handler of this.removeHandlers) {
      handler(agentId);
    }
  }

  private recordToolOutcome(agentId: string, succeeded: boolean): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const outcomes = this.recentToolOutcomes.get(agentId) ?? [];
    outcomes.push(succeeded);
    while (outcomes.length > 25) {
      outcomes.shift();
    }

    this.recentToolOutcomes.set(agentId, outcomes);
    agent.recent_tool_call_count = outcomes.length;
    agent.tool_call_success_rate = outcomes.length > 0
      ? outcomes.filter(Boolean).length / outcomes.length
      : 1;
  }
}
