/**
 * UAEP-min (Universal Agent Event Protocol - Lightweight)
 *
 * Phase 1 표준: L1~L2 시각화에 필요한 최소 이벤트 정의.
 * 모든 에이전트 소스(Claude Code, OpenClaw, Agent SDK 등)의
 * 이벤트를 통일된 포맷으로 정규화한다.
 */

/** 에이전트 원본 소스 종류 */
export type AgentSourceType =
  | 'claude_code'
  | 'openclaw'
  | 'agent_sdk'
  | 'langchain'
  | 'crewai'
  | 'custom'
  | 'mission_control';

/** UAEP 이벤트 타입 (Phase 1 최소 세트) */
export type UAEPEventType =
  | 'session.start'
  | 'session.end'
  | 'agent.status'
  | 'tool.start'
  | 'tool.end'
  | 'tool.error'
  | 'llm.start'
  | 'llm.end'
  | 'user.input'
  | 'user.permission'
  | 'subagent.spawn'
  | 'subagent.end'
  | 'metrics.usage'
  | 'task.sync'
  | 'task.snapshot'
  | 'goal.snapshot'
  | 'activity.new'
  | 'notification.new';

/**
 * UAEP-min 이벤트 Envelope.
 *
 * 모든 이벤트의 공통 구조. OpenTelemetry Span 모델을 기반으로
 * trace_id(session_id) -> span_id 계층 구조를 따른다.
 */
export interface UAEPEvent {
  /** ISO-8601 타임스탬프 */
  ts: string;

  /** 소스별 증가 시퀀스 (선택) */
  seq?: number;

  /** UUID v7 (시간 순서 보장) */
  event_id: string;

  /** 원본 소스 종류 */
  source: AgentSourceType;

  /** 에이전트 고유 ID */
  agent_id: string;

  /** 에이전트 표시 이름 */
  agent_name?: string;

  /** 세션/trace 단위 식별자 */
  session_id: string;

  /** 사용 중인 LLM 모델 ID (예: "claude-sonnet-4-6") */
  model_id?: string;

  /** 작업 단위 span (tool/llm call) */
  span_id?: string;

  /** 부모 span (서브에이전트 연결) */
  parent_span_id?: string;

  /** 스웜/팀 묶음 식별자 */
  team_id?: string;

  /** 프로젝트/작업 디렉토리 식별자 */
  project_id?: string;

  /** 이벤트 종류 */
  type: UAEPEventType;

  /** 이벤트 페이로드 (타입별 데이터) */
  data?: Record<string, unknown>;

  /** 원본 보존 메타데이터 */
  metadata?: Record<string, unknown>;
}

/** 지원하는 모든 AgentSourceType 값 목록 */
export const AGENT_SOURCE_TYPES: readonly AgentSourceType[] = [
  'claude_code',
  'openclaw',
  'agent_sdk',
  'langchain',
  'crewai',
  'custom',
  'mission_control',
] as const;

/** 지원하는 모든 UAEPEventType 값 목록 */
export const UAEP_EVENT_TYPES: readonly UAEPEventType[] = [
  'session.start',
  'session.end',
  'agent.status',
  'tool.start',
  'tool.end',
  'tool.error',
  'llm.start',
  'llm.end',
  'user.input',
  'user.permission',
  'subagent.spawn',
  'subagent.end',
  'metrics.usage',
  'task.sync',
  'task.snapshot',
  'goal.snapshot',
  'activity.new',
  'notification.new',
] as const;
