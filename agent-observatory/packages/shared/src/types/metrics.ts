/**
 * 메트릭 타입 정의.
 *
 * MetricsAggregator가 이벤트를 집계하여 생성하는 스냅샷.
 * 대시보드의 메트릭 패널과 시계열 차트에서 사용된다.
 */

import type { AgentSourceType } from './uaep.js';
import type { ToolCategory } from './agent.js';

/**
 * 메트릭 스냅샷.
 *
 * 현재 시점의 전체 시스템 메트릭을 담는 구조체.
 * WebSocket `metrics:snapshot` 이벤트와 REST `/api/v1/metrics/summary`로 전달.
 */
export interface MetricsSnapshot {
  /** 스냅샷 생성 시각 (ISO-8601) */
  timestamp: string;

  /** 현재 활성 에이전트 수 */
  active_agents: number;

  /** 전체 등록 에이전트 수 (비활성 포함) */
  total_agents: number;

  /** 분당 토큰 사용량 */
  total_tokens_per_minute: number;

  /** 시간당 비용 (USD) */
  total_cost_per_hour: number;

  /** 최근 1시간 에러 수 */
  total_errors_last_hour: number;

  /** 분당 도구 호출 수 */
  total_tool_calls_per_minute: number;

  /** 도구 카테고리별 사용 횟수 분포 */
  tool_distribution: Record<ToolCategory, number>;

  /** 에이전트 소스별 분포 */
  source_distribution: Record<AgentSourceType, number>;

  /** 시계열 데이터 (슬라이딩 윈도우) */
  timeseries: MetricsTimeseries;
}

/**
 * 메트릭 시계열 데이터.
 *
 * 슬라이딩 윈도우 기반의 시계열 배열.
 * 각 배열의 인덱스가 동일한 시간대를 가리킨다.
 */
export interface MetricsTimeseries {
  /** 시간축 (ISO-8601 타임스탬프 배열) */
  timestamps: string[];

  /** 분당 토큰 수 */
  tokens_per_minute: number[];

  /** 분당 비용 (USD) */
  cost_per_minute: number[];

  /** 활성 에이전트 수 */
  active_agents: number[];

  /** 분당 도구 호출 수 */
  tool_calls_per_minute: number[];

  /** 에러 발생 수 */
  error_count: number[];
}
