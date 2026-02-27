/**
 * 에이전트 상태 타입 정의.
 *
 * 실시간 대시보드와 픽셀 시각화에서 사용되는
 * 에이전트 라이브 상태 모델.
 */

import type { AgentSourceType } from './uaep.js';

/** 에이전트 현재 상태 */
export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'acting'
  | 'waiting_input'
  | 'waiting_permission'
  | 'error';

/**
 * 도구 행동 카테고리.
 *
 * 픽셀 애니메이션은 도구 이름이 아닌 행동 카테고리로 구동.
 * 대시보드에서도 카테고리별 분포를 표시한다.
 */
export type ToolCategory =
  | 'file_read'
  | 'file_write'
  | 'command'
  | 'search'
  | 'web'
  | 'planning'
  | 'thinking'
  | 'communication'
  | 'other';

/**
 * 에이전트 실시간 상태.
 *
 * StateManager가 UAEP 이벤트를 소비하여 갱신하는 라이브 스냅샷.
 * WebSocket을 통해 클라이언트에 전달된다.
 */
export interface AgentLiveState {
  /** 에이전트 고유 ID */
  agent_id: string;

  /** 에이전트 표시 이름 */
  agent_name: string;

  /** 원본 소스 종류 */
  source: AgentSourceType;

  /** 스웜/팀 묶음 식별자 */
  team_id?: string;

  /** 프로젝트/작업 디렉토리 식별자 */
  project_id?: string;

  /** 현재 상태 */
  status: AgentStatus;

  /** 현재 사용 중인 도구 이름 */
  current_tool?: string;

  /** 현재 사용 중인 도구의 카테고리 */
  current_tool_category?: ToolCategory;

  /** 상태 상세 (예: "Reading: src/main.ts") */
  status_detail?: string;

  /** 마지막 활동 시각 (ISO-8601) */
  last_activity: string;

  /** 현재 세션 ID */
  session_id: string;

  /** 세션 시작 시각 (ISO-8601) */
  session_start: string;

  /** 사용 중인 LLM 모델 ID (예: "claude-sonnet-4-6") */
  model_id?: string;

  /** 누적 입력 토큰 수 */
  total_input_tokens: number;

  /** 누적 출력 토큰 수 */
  total_output_tokens: number;

  /** 누적 토큰 수 (input + output) */
  total_tokens: number;

  /** 캐시 생성에 사용된 토큰 수 (비용 발생) */
  cache_creation_tokens: number;

  /** 캐시에서 읽은 토큰 수 (비용 절감) */
  cache_read_tokens: number;

  /** 누적 비용 (USD) */
  total_cost_usd: number;

  /** 누적 도구 호출 수 */
  total_tool_calls: number;

  /** 누적 에러 수 */
  total_errors: number;

  /** llm.end 이벤트 수 (LLM 응답 횟수) */
  llm_response_count: number;

  /** llm.end 기준 응답 텍스트 총 길이 */
  llm_total_text_length: number;

  /** 도구 카테고리별 사용 횟수 분포 */
  tool_distribution: Record<ToolCategory, number>;

  /** 부모 에이전트 ID (서브에이전트인 경우) */
  parent_agent_id?: string;

  /** 자식 에이전트 ID 목록 */
  child_agent_ids: string[];
}

/**
 * 에이전트 계층 트리 노드.
 *
 * StateManager.getHierarchy()가 반환하는 재귀적 트리 구조.
 */
export interface AgentHierarchyNode {
  agent: AgentLiveState;
  children: AgentHierarchyNode[];
}

/** 지원하는 모든 AgentStatus 값 목록 */
export const AGENT_STATUSES: readonly AgentStatus[] = [
  'idle',
  'thinking',
  'acting',
  'waiting_input',
  'waiting_permission',
  'error',
] as const;

/** 지원하는 모든 ToolCategory 값 목록 */
export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  'file_read',
  'file_write',
  'command',
  'search',
  'web',
  'planning',
  'thinking',
  'communication',
  'other',
] as const;
