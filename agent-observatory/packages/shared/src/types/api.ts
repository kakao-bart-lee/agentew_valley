/**
 * REST API 요청/응답 타입 + WebSocket 이벤트 페이로드 타입.
 *
 * Server -> Web(FE) 연결 지점의 계약(contract) 정의.
 */

import type { UAEPEvent } from './uaep.js';
import type { AgentLiveState, AgentHierarchyNode } from './agent.js';
import type { MetricsSnapshot } from './metrics.js';

// ─── REST API 응답 타입 ───

/** GET /api/v1/agents 응답 */
export interface AgentsListResponse {
  agents: AgentLiveState[];
  total: number;
}

/** GET /api/v1/agents/:id 응답 */
export interface AgentDetailResponse {
  agent: AgentLiveState;
}

/** GET /api/v1/agents/:id/events 응답 (페이지네이션) */
export interface AgentEventsResponse {
  events: UAEPEvent[];
  total: number;
  offset: number;
  limit: number;
}

/** GET /api/v1/sessions 응답 */
export interface SessionsListResponse {
  sessions: SessionSummary[];
  total: number;
}

/** 세션 요약 정보 */
export interface SessionSummary {
  session_id: string;
  agent_id: string;
  agent_name: string;
  source: string;
  team_id?: string;
  project_id?: string;
  model_id?: string;
  start_time: string;
  end_time?: string;
  total_events: number;
  total_tokens: number;
  total_cost_usd: number;
}

/** GET /api/v1/metrics/summary 응답 */
export interface MetricsSummaryResponse {
  metrics: MetricsSnapshot;
}

/** GET /api/v1/agents/hierarchy 응답 */
export interface AgentHierarchyResponse {
  hierarchy: AgentHierarchyNode[];
}

/** GET /api/v1/agents/by-team 응답 */
export interface AgentsByTeamResponse {
  teams: { team_id: string; agents: AgentLiveState[] }[];
}

/** GET /api/v1/events/search 응답 */
export interface EventSearchResponse {
  query: string;
  events: UAEPEvent[];
  total: number;
}

/** GET /api/v1/config 응답 */
export interface ConfigResponse {
  config: ObservatoryConfig;
}

/** 서비스 설정 */
export interface ObservatoryConfig {
  /** JSONL 감시 경로 목록 */
  watch_paths: string[];
  /** WebSocket 메트릭 전송 간격 (ms) */
  metrics_interval_ms: number;
  /** 인메모리 시계열 보존 기간 (분) */
  timeseries_retention_minutes: number;
}

// ─── Session Replay ───

/** 재생용 이벤트 (gap/offset 포함) */
export interface ReplayEvent {
  event: UAEPEvent;
  /** 이전 이벤트와의 간격 (ms) */
  gap_ms: number;
  /** 세션 시작으로부터 경과 (ms) */
  offset_ms: number;
}

/** 세션 재생 요약 정보 */
export interface SessionReplaySummary {
  agent_id: string;
  agent_name: string;
  source: string;
  team_id?: string;
  project_id?: string;
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

/** GET /api/v1/sessions/:id/replay 응답 */
export interface SessionReplayResponse {
  session_id: string;
  summary: SessionReplaySummary;
  events: ReplayEvent[];
  total_events: number;
  time_range?: { from: string; to: string };
}

// ─── Cost/Token Analytics ───

/** GET /api/v1/analytics/cost 응답 */
export interface CostAnalyticsResponse {
  time_range: { from: string; to: string };
  total_cost_usd: number;
  total_tokens: number;
  total_sessions: number;
  cost_timeseries: { ts: string; cost: number; tokens: number }[];
}

/** 에이전트별 비용 항목 */
export interface AgentCostEntry {
  agent_id: string;
  agent_name: string;
  source: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  cost_percentage: number;
}

/** GET /api/v1/analytics/cost/by-agent 응답 */
export interface CostByAgentResponse {
  time_range: { from: string; to: string };
  agents: AgentCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

/** 프로젝트별 비용 항목 */
export interface ProjectCostEntry {
  project_id: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  agent_count: number;
  cost_percentage: number;
}

/** GET /api/v1/analytics/cost/by-project 응답 */
export interface CostByProjectResponse {
  time_range: { from: string; to: string };
  projects: ProjectCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

/** 팀별 비용 항목 */
export interface TeamCostEntry {
  team_id: string;
  total_cost_usd: number;
  total_tokens: number;
  agent_count: number;
  session_count: number;
  cost_percentage: number;
}

/** GET /api/v1/analytics/cost/by-team 응답 */
export interface CostByTeamResponse {
  time_range: { from: string; to: string };
  teams: TeamCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

/** 모델별 비용 항목 */
export interface ModelCostEntry {
  model_id: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  agent_count: number;
  cost_percentage: number;
}

/** GET /api/v1/analytics/cost/by-model 응답 */
export interface CostByModelResponse {
  time_range: { from: string; to: string };
  models: ModelCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

/** 도구별 비용 항목 */
export interface ToolCostEntry {
  tool_category: string;
  call_count: number;
  estimated_cost_usd: number;
  cost_percentage: number;
}

/** GET /api/v1/analytics/cost/by-tool 응답 */
export interface CostByToolResponse {
  time_range: { from: string; to: string };
  tools: ToolCostEntry[];
  total_cost_usd: number;
}

/** GET /api/v1/analytics/tokens 응답 */
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

export interface StaleTaskEntry {
  id: string;
  title: string;
  project?: string;
  assigned_to?: string;
  checkout_agent_id?: string;
  started_at?: number;
  updated_at: number;
  stale_for_seconds: number;
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
  stale_tasks: StaleTaskEntry[];
  pending_alerts: number;
  alert_severity: 'ok' | 'warning' | 'critical';
  mc_db_connected: boolean;
}

// ─── WebSocket 이벤트 페이로드 타입 ───

/** WebSocket 초기 연결 시 전달되는 상태 (socket.emit('init')) */
export interface WSInitPayload {
  agents: AgentLiveState[];
  metrics: MetricsSnapshot;
}

/** socket.emit('agent:state') 페이로드 */
export type WSAgentStatePayload = AgentLiveState;

/** socket.emit('agent:remove') 페이로드 */
export interface WSAgentRemovePayload {
  agent_id: string;
}

/** socket.emit('event') 페이로드 */
export type WSEventPayload = UAEPEvent;

/** socket.emit('metrics:snapshot') 페이로드 */
export type WSMetricsSnapshotPayload = MetricsSnapshot;

// ─── WebSocket 이벤트 맵 (타입 안전한 Socket.IO 사용) ───

/** Server -> Client 이벤트 맵 */
export interface ServerToClientEvents {
  'init': (payload: WSInitPayload) => void;
  'agent:state': (payload: WSAgentStatePayload) => void;
  'agent:remove': (payload: WSAgentRemovePayload) => void;
  'event': (payload: WSEventPayload) => void;
  'metrics:snapshot': (payload: WSMetricsSnapshotPayload) => void;
}

/** Client -> Server 이벤트 맵 */
export interface ClientToServerEvents {
  'subscribe': (agentId: string) => void;
  'unsubscribe': (agentId: string) => void;
  'set_view': (viewType: 'dashboard' | 'pixel' | 'timeline') => void;
}
