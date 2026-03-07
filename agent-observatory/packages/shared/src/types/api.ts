/**
 * REST API 요청/응답 타입 + WebSocket 이벤트 페이로드 타입.
 *
 * Server -> Web(FE) 연결 지점의 계약(contract) 정의.
 */

import type { RuntimeDescriptor, TaskContextRef, UAEPEvent } from './uaep.js';
import type { AgentLiveState } from './agent.js';
import type { MetricsSnapshot } from './metrics.js';

// ─── REST API 응답 타입 ───

export interface AgentsListResponse {
  agents: AgentLiveState[];
  total: number;
}

export interface AgentDetailResponse {
  agent: AgentLiveState;
}

export interface AgentEventsResponse {
  events: UAEPEvent[];
  total: number;
  offset: number;
  limit: number;
}

export interface SessionsListResponse {
  sessions: SessionSummary[];
  total: number;
}

export interface SessionSummary {
  session_id: string;
  agent_id: string;
  agent_name: string;
  source: string;
  runtime?: RuntimeDescriptor;
  team_id?: string;
  project_id?: string;
  task_id?: string;
  goal_id?: string;
  task_context?: TaskContextRef;
  model_id?: string;
  start_time: string;
  end_time?: string;
  total_events: number;
  total_tokens: number;
  total_cost_usd: number;
}

export interface MetricsSummaryResponse {
  metrics: MetricsSnapshot;
}

export interface AgentsByTeamResponse {
  teams: { team_id: string; agents: AgentLiveState[] }[];
}

export interface EventSearchResponse {
  query: string;
  events: UAEPEvent[];
  total: number;
}

export interface ConfigResponse {
  config: ObservatoryConfig;
}

export interface ObservatoryConfig {
  watch_paths: string[];
  metrics_interval_ms: number;
  timeseries_retention_minutes: number;
}

// ─── Session Replay ───

export interface ReplayEvent {
  event: UAEPEvent;
  gap_ms: number;
  offset_ms: number;
}

export interface SessionReplaySummary {
  agent_id: string;
  agent_name: string;
  source: string;
  runtime?: RuntimeDescriptor;
  team_id?: string;
  project_id?: string;
  task_id?: string;
  goal_id?: string;
  task_context?: TaskContextRef;
  model_id?: string;
  start_time: string;
  end_time?: string;
  duration_ms: number;
  total_events: number;
  total_tokens: number;
  total_cost_usd: number;
  total_tool_calls: number;
  event_type_counts: Record<string, number>;
}

export interface SessionReplayResponse {
  session_id: string;
  summary: SessionReplaySummary;
  events: ReplayEvent[];
  total_events: number;
  time_range?: { from: string; to: string };
}

export interface TaskContextSnapshot extends TaskContextRef {
  provider: NonNullable<TaskContextRef['provider']>;
  session_id?: string;
  agent_id?: string;
  resolved_from: 'session' | 'agent' | 'event' | 'task';
  task?: {
    id: string;
    title?: string;
    status?: string;
    project?: string;
  };
  goal?: {
    id: string;
    title?: string;
    status?: string;
  };
}

export interface TaskContextResponse {
  task_context?: TaskContextSnapshot;
}

// ─── Cost/Token Analytics ───

export interface CostAnalyticsResponse {
  time_range: { from: string; to: string };
  total_cost_usd: number;
  total_tokens: number;
  total_sessions: number;
  cost_timeseries: { ts: string; cost: number; tokens: number }[];
}

export interface AgentCostEntry {
  agent_id: string;
  agent_name: string;
  source: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  cost_percentage: number;
}

export interface CostByAgentResponse {
  time_range: { from: string; to: string };
  agents: AgentCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

export interface ProjectCostEntry {
  project_id: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  agent_count: number;
  cost_percentage: number;
}

export interface CostByProjectResponse {
  time_range: { from: string; to: string };
  projects: ProjectCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

export interface TeamCostEntry {
  team_id: string;
  total_cost_usd: number;
  total_tokens: number;
  agent_count: number;
  session_count: number;
  cost_percentage: number;
}

export interface CostByTeamResponse {
  time_range: { from: string; to: string };
  teams: TeamCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

export interface ModelCostEntry {
  model_id: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  agent_count: number;
  cost_percentage: number;
}

export interface CostByModelResponse {
  time_range: { from: string; to: string };
  models: ModelCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

export interface ToolCostEntry {
  tool_category: string;
  call_count: number;
  estimated_cost_usd: number;
  cost_percentage: number;
}

export interface CostByToolResponse {
  time_range: { from: string; to: string };
  tools: ToolCostEntry[];
  total_cost_usd: number;
}

export interface TokenAnalyticsResponse {
  time_range: { from: string; to: string };
  total_tokens: number;
  tokens_timeseries: { ts: string; tokens: number }[];
  by_agent: { agent_id: string; agent_name: string; total_tokens: number }[];
}

export interface BudgetAlertEntry {
  agent_id: string;
  agent_name: string;
  budget_monthly_cents: number;
  spent_monthly_cents: number;
  spent_monthly_usd: number;
  utilization_ratio: number;
  severity: 'warning' | 'critical';
}

export interface UntrackedSummary {
  /** project_id = null인 세션 수 */
  session_count: number;
  total_cost_usd: number;
  total_tokens: number;
}

export interface DashboardSummaryResponse {
  time_range: { from: string; to: string };
  cost_summary: {
    total_cost_usd: number;
    total_tokens: number;
    total_sessions: number;
  };
  top_projects: ProjectCostEntry[];
  top_agents: AgentCostEntry[];
  top_models: ModelCostEntry[];
  budget_alerts: BudgetAlertEntry[];
  pending_alerts: number;
  alert_severity: 'ok' | 'warning' | 'critical';
  /** R-004: Paperclip 컨텍스트 없이 실행된 세션 집계 */
  untracked_summary: UntrackedSummary;
}

export interface RealtimeAgentStatusPayload {
  agent: AgentLiveState;
}

// ─── WebSocket 이벤트 페이로드 타입 ───

export interface WSInitPayload {
  agents: AgentLiveState[];
  metrics: MetricsSnapshot;
}

export type WSAgentStatePayload = AgentLiveState;

export interface WSAgentRemovePayload {
  agent_id: string;
}

export type WSEventPayload = UAEPEvent;

export type WSMetricsSnapshotPayload = MetricsSnapshot;

// ─── WebSocket 이벤트 맵 (타입 안전한 Socket.IO 사용) ───

/** R-007: Paperclip task 컨텍스트가 세션에 부착될 때 브로드캐스트 */
export interface WSTaskContextPayload {
  agent_id: string;
  session_id: string;
  project_id?: string;
  task_id?: string;
  goal_id?: string;
}

/** R-007: 예산 임계값 도달 알림 */
export interface WSCostAlertPayload {
  agent_id: string;
  agent_name: string;
  budget_monthly_usd: number;
  spent_monthly_usd: number;
  utilization_ratio: number;
  severity: 'warning' | 'critical';
}

/** R-007: 에이전트 건강 상태 변화 알림 */
export interface WSAgentHealthPayload {
  agent_id: string;
  status: string;
  total_errors: number;
  total_tool_calls: number;
  /** 최근 활동의 오류 비율 (0~1) */
  error_rate: number;
}

export interface ServerToClientEvents {
  'init': (payload: WSInitPayload) => void;
  'agent:state': (payload: WSAgentStatePayload) => void;
  'agent:remove': (payload: WSAgentRemovePayload) => void;
  'event': (payload: WSEventPayload) => void;
  'metrics:snapshot': (payload: WSMetricsSnapshotPayload) => void;
  'agent.status': (payload: RealtimeAgentStatusPayload) => void;
  /** R-007: task 컨텍스트 변경 */
  'task.context': (payload: WSTaskContextPayload) => void;
  /** R-007: 예산 알림 */
  'cost.alert': (payload: WSCostAlertPayload) => void;
  /** R-007: 에이전트 건강 상태 변화 */
  'agent.health': (payload: WSAgentHealthPayload) => void;
}

export interface ClientToServerEvents {
  'subscribe': (agentId: string) => void;
  'unsubscribe': (agentId: string) => void;
  'set_view': (viewType: 'dashboard' | 'pixel') => void;
}
