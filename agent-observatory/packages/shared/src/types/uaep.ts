/**
 * UAEP-min (Universal Agent Event Protocol - Lightweight)
 *
 * Phase 1 표준: L1~L2 시각화에 필요한 최소 이벤트 정의.
 * 모든 에이전트 소스(Claude Code, OpenClaw, Agent SDK 등)의
 * 이벤트를 통일된 포맷으로 정규화한다.
 */

/** 에이전트 원본 소스 종류 (ingestion source) */
export type AgentSourceType =
  | 'claude_code'
  | 'openclaw'
  | 'omx'
  | 'codex'
  | 'opencode'
  | 'agent_sdk'
  | 'langchain'
  | 'crewai'
  | 'custom'
  | 'mission_control'
  | 'pm2';

/** 관측 대상 런타임 제품군 */
export type AgentRuntimeFamily =
  | 'claude_code'
  | 'openclaw'
  | 'codex'
  | 'opencode'
  | 'agent_sdk'
  | 'langchain'
  | 'crewai'
  | 'custom'
  | 'mission_control';

/** 런타임을 감싸는 상위 오케스트레이터 */
export type AgentOrchestratorType =
  | 'none'
  | 'omx'
  | 'paperclip'
  | 'mission_control'
  | 'custom';

/** 실제 수집/전달 경로를 설명하는 클라이언트 타입 */
export type AgentClientType =
  | 'native'
  | 'jsonl'
  | 'hooks'
  | 'sqlite'
  | 'http'
  | 'sdk'
  | 'omx'
  | 'custom';

/** 이벤트가 유입된 transport / ingestion 종류 */
export type EventIngestionKind =
  | 'jsonl'
  | 'hook'
  | 'sqlite'
  | 'state'
  | 'http'
  | 'collector_ws'
  | 'manual'
  | 'unknown';

/** source와 분리된 canonical runtime 분류 */
export interface RuntimeDescriptor {
  /** 실제 런타임 제품군 */
  family: AgentRuntimeFamily;

  /** 런타임 위에 있는 orchestration/control plane */
  orchestrator?: AgentOrchestratorType;

  /** 현재 이벤트/세션을 보낸 client or ingestion persona */
  client?: AgentClientType;
}

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
  | 'notification.new'
  | 'approval.created'
  | 'approval.updated';

export interface WorkContextRef {
  /** 프로젝트/작업 디렉토리 식별자 */
  project_id?: string;

  /** 개별 작업 식별자 */
  task_id?: string;

  /** 상위 목표 식별자 */
  goal_id?: string;
}

/** WorkContext를 확장한 task overlay 참조. 미래 Paperclip 연동 seam. */
export interface TaskContextRef extends WorkContextRef {
  /** 현재 문맥을 해석한 provider */
  provider?: 'history_store' | 'paperclip' | 'mission_control' | 'runtime' | 'unknown';

  /** 외부 이슈 식별자 (예: Paperclip issue id) */
  issue_id?: string;

  /** 사람이 보는 issue key / identifier */
  issue_identifier?: string;

  /** 실행/체크아웃 런 링크 */
  execution_run_id?: string;
  checkout_run_id?: string;

  /** 보강된 요약 정보 */
  title?: string;
  status?: string;
}

/** dedupe / provenance scaffolding */
export interface EventProvenance {
  /** 수집기 식별자 */
  collector?: string;

  /** 이벤트가 유입된 transport */
  ingestion_kind?: EventIngestionKind;

  /** 원본 시스템이 가진 event/message id */
  source_event_id?: string;

  /** 원본 이벤트 수준 fingerprint */
  source_event_fingerprint?: string;

  /** 파일/DB/logical path */
  source_path?: string;

  /** 원본 오프셋 (jsonl line, sqlite rowid 등) */
  source_offset?: number;

  /** 원본 타입 이름 */
  raw_event_type?: string;

  /** Observatory가 수신한 시각 */
  received_at?: string;

  /** canonical dedupe key */
  dedupe_key?: string;

  /** 수송 계층 / trigger */
  transport?: string;
}

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

  /** canonical runtime taxonomy */
  runtime?: RuntimeDescriptor;

  /** 작업 단위 span (tool/llm call) */
  span_id?: string;

  /** 부모 span (서브에이전트 연결) */
  parent_span_id?: string;

  /** 스웜/팀 묶음 식별자 */
  team_id?: string;

  /** 업무 컨텍스트 식별자 */
  project_id?: WorkContextRef['project_id'];
  task_id?: WorkContextRef['task_id'];
  goal_id?: WorkContextRef['goal_id'];

  /** richer task/work overlay */
  task_context?: TaskContextRef;

  /** 이벤트 종류 */
  type: UAEPEventType;

  /** 이벤트 페이로드 (타입별 데이터) */
  data?: Record<string, unknown>;

  /** 원본 보존 메타데이터 */
  metadata?: Record<string, unknown>;

  /** provenance / dedupe scaffolding */
  provenance?: EventProvenance;
}

/** 지원하는 모든 AgentSourceType 값 목록 */
export const AGENT_SOURCE_TYPES: readonly AgentSourceType[] = [
  'claude_code',
  'openclaw',
  'omx',
  'codex',
  'opencode',
  'agent_sdk',
  'langchain',
  'crewai',
  'custom',
  'mission_control',
  'pm2',
] as const;

/** 지원하는 모든 AgentRuntimeFamily 값 목록 */
export const AGENT_RUNTIME_FAMILIES: readonly AgentRuntimeFamily[] = [
  'claude_code',
  'openclaw',
  'codex',
  'opencode',
  'agent_sdk',
  'langchain',
  'crewai',
  'custom',
  'mission_control',
] as const;

/** 지원하는 모든 AgentOrchestratorType 값 목록 */
export const AGENT_ORCHESTRATOR_TYPES: readonly AgentOrchestratorType[] = [
  'none',
  'omx',
  'paperclip',
  'mission_control',
  'custom',
] as const;

/** 지원하는 모든 AgentClientType 값 목록 */
export const AGENT_CLIENT_TYPES: readonly AgentClientType[] = [
  'native',
  'jsonl',
  'hooks',
  'sqlite',
  'http',
  'sdk',
  'omx',
  'custom',
] as const;

/** 지원하는 모든 EventIngestionKind 값 목록 */
export const EVENT_INGESTION_KINDS: readonly EventIngestionKind[] = [
  'jsonl',
  'hook',
  'sqlite',
  'state',
  'http',
  'collector_ws',
  'manual',
  'unknown',
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
  'approval.created',
  'approval.updated',
] as const;
