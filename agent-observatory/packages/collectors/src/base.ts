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
