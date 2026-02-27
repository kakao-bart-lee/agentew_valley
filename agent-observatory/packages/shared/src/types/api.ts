/**
 * REST API 요청/응답 타입 + WebSocket 이벤트 페이로드 타입.
 *
 * Server -> Web(FE) 연결 지점의 계약(contract) 정의.
 */

import type { UAEPEvent } from './uaep.js';
import type { AgentLiveState } from './agent.js';
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
