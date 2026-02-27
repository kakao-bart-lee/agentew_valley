/**
 * Collector 분리 아키텍처 — WebSocket 통신 타입 정의.
 *
 * Collector가 독립 프로세스로 실행되어 서버와 WebSocket으로 통신할 때 사용하는 타입들.
 */

import type { AgentSourceType, UAEPEvent } from './uaep.js';

/** Collector 등록 정보 (서버에 전달) */
export interface CollectorRegistration {
  /** Collector 고유 ID — CLI 시작 시 생성 */
  collector_id: string;
  /** Collector 이름 (예: "claude-code", "openclaw") */
  name: string;
  /** 수집 대상 소스 종류 */
  source_type: AgentSourceType;
  /** 머신 호스트명 */
  machine_id: string;
  /** 감시 경로 목록 */
  watch_paths: string[];
  /** CLI 버전 */
  version: string;
}

/** 서버가 추적하는 연결된 Collector 상태 */
export interface ConnectedCollector {
  /** Collector 고유 ID */
  collector_id: string;
  /** Collector 이름 */
  name: string;
  /** 수집 대상 소스 종류 */
  source_type: AgentSourceType;
  /** 머신 호스트명 */
  machine_id: string;
  /** 연결 시각 (ISO-8601) */
  connected_at: string;
  /** 마지막 heartbeat 시각 (ISO-8601) */
  last_heartbeat: string;
  /** 수신한 이벤트 수 */
  events_received: number;
}

/** Collector → Server WebSocket 이벤트 */
export interface CollectorToServerEvents {
  'collector:register': (reg: CollectorRegistration) => void;
  'collector:events': (events: UAEPEvent[], ack: (count: number) => void) => void;
  'collector:heartbeat': () => void;
}

/** Server → Collector WebSocket 이벤트 */
export interface ServerToCollectorEvents {
  'collector:registered': (data: { collector_id: string }) => void;
  'collector:error': (data: { code: string; message: string }) => void;
}
