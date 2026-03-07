/**
 * Collector 기본 인터페이스 및 설정 타입.
 *
 * 모든 소스별 Collector가 구현해야 하는 공통 계약.
 */

import type { UAEPEvent, AgentSourceType } from '@agent-observatory/shared';

/** Collector 공통 설정 */
export interface CollectorConfig {
  /** 감시할 디렉토리/파일 경로 목록 */
  watchPaths: string[];
  /** true면 기존 파일은 건너뛰고 새로 추가되는 내용만 수집. 기본 false. */
  tailOnly?: boolean;
}

/** 소스별 Collector가 구현하는 인터페이스 */
export interface Collector {
  /** Collector 이름 (예: "ClaudeCodeCollector") */
  readonly name: string;

  /** 수집 대상 소스 종류 */
  readonly sourceType: AgentSourceType;

  /** 파일 감시 시작 */
  start(): Promise<void>;

  /** 파일 감시 중지 및 리소스 정리 */
  stop(): Promise<void>;

  /** UAEP 이벤트 핸들러 등록 */
  onEvent(handler: (event: UAEPEvent) => void): void;
}

/** R-002: Context Enrichment — 환경변수에서 컨텍스트 읽기 */
export interface CollectorContext {
  task_id?: string;
  project_id?: string;
  goal_id?: string;
}

/**
 * 환경변수에서 Paperclip 컨텍스트를 읽는다.
 * Paperclip/OpenClaw가 에이전트 spawn 시 주입하는 값.
 *   OBSERVATORY_TASK_ID    → task_id
 *   OBSERVATORY_PROJECT_ID → project_id
 *   OBSERVATORY_GOAL_ID    → goal_id
 */
export function readContextFromEnv(): CollectorContext {
  return {
    task_id: process.env['OBSERVATORY_TASK_ID'] || undefined,
    project_id: process.env['OBSERVATORY_PROJECT_ID'] || undefined,
    goal_id: process.env['OBSERVATORY_GOAL_ID'] || undefined,
  };
}

/**
 * 이벤트에 컨텍스트를 overlay한다.
 * 이벤트에 이미 값이 있으면 덮어쓰지 않는다 (Collector가 더 구체적인 컨텍스트를 가질 수 있음).
 */
export function enrichWithContext(event: UAEPEvent, ctx: CollectorContext): UAEPEvent {
  if (!ctx.task_id && !ctx.project_id && !ctx.goal_id) return event;
  return {
    ...event,
    task_id: event.task_id ?? ctx.task_id,
    project_id: event.project_id ?? ctx.project_id,
    goal_id: event.goal_id ?? ctx.goal_id,
  };
}
