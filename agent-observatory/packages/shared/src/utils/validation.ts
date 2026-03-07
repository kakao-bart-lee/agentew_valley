/**
 * UAEPEvent 필수 필드 검증 유틸리티.
 *
 * Zod 없이 수동 검증으로 런타임 의존성 제로를 유지한다.
 * 외부에서 수신한 이벤트가 UAEP-min 규격에 맞는지 확인.
 */

import { AGENT_SOURCE_TYPES, UAEP_EVENT_TYPES } from '../types/uaep.js';
import {
  AGENT_CLIENT_TYPES,
  AGENT_ORCHESTRATOR_TYPES,
  AGENT_RUNTIME_FAMILIES,
  EVENT_INGESTION_KINDS,
} from '../types/uaep.js';
import type { UAEPEvent, AgentSourceType, UAEPEventType } from '../types/uaep.js';

/** 검증 결과 */
export interface ValidationResult {
  /** 검증 통과 여부 */
  valid: boolean;
  /** 검증 실패 시 에러 목록 */
  errors: string[];
}

/** AgentSourceType 유효성 확인용 Set */
const SOURCE_TYPE_SET = new Set<string>(AGENT_SOURCE_TYPES);

/** UAEPEventType 유효성 확인용 Set */
const EVENT_TYPE_SET = new Set<string>(UAEP_EVENT_TYPES);
const RUNTIME_FAMILY_SET = new Set<string>(AGENT_RUNTIME_FAMILIES);
const ORCHESTRATOR_SET = new Set<string>(AGENT_ORCHESTRATOR_TYPES);
const CLIENT_SET = new Set<string>(AGENT_CLIENT_TYPES);
const INGESTION_SET = new Set<string>(EVENT_INGESTION_KINDS);

/**
 * 값이 비어있지 않은 문자열인지 확인한다.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 값이 유효한 ISO-8601 타임스탬프인지 확인한다.
 */
function isValidTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * 값이 유효한 AgentSourceType인지 확인한다.
 */
export function isValidSourceType(value: unknown): value is AgentSourceType {
  return typeof value === 'string' && SOURCE_TYPE_SET.has(value);
}

/**
 * 값이 유효한 UAEPEventType인지 확인한다.
 */
export function isValidEventType(value: unknown): value is UAEPEventType {
  return typeof value === 'string' && EVENT_TYPE_SET.has(value);
}

/**
 * UAEPEvent 객체의 필수 필드를 검증한다.
 *
 * 필수 필드: ts, event_id, source, agent_id, session_id, type
 * 선택 필드는 존재할 경우 타입만 검증한다.
 *
 * @param event - 검증할 이벤트 객체
 * @returns 검증 결과 (valid + errors)
 */
export function validateUAEPEvent(event: unknown): ValidationResult {
  const errors: string[] = [];

  if (event === null || event === undefined || typeof event !== 'object') {
    return { valid: false, errors: ['Event must be a non-null object'] };
  }

  const e = event as Record<string, unknown>;

  // 필수 필드 검증
  if (!isValidTimestamp(e.ts)) {
    errors.push('ts: must be a valid ISO-8601 timestamp string');
  }

  if (!isNonEmptyString(e.event_id)) {
    errors.push('event_id: must be a non-empty string');
  }

  if (!isValidSourceType(e.source)) {
    errors.push(`source: must be one of ${AGENT_SOURCE_TYPES.join(', ')}`);
  }

  if (!isNonEmptyString(e.agent_id)) {
    errors.push('agent_id: must be a non-empty string');
  }

  if (!isNonEmptyString(e.session_id)) {
    errors.push('session_id: must be a non-empty string');
  }

  if (!isValidEventType(e.type)) {
    errors.push(`type: must be one of ${UAEP_EVENT_TYPES.join(', ')}`);
  }

  // 선택 필드 타입 검증 (존재하는 경우에만)
  if (e.seq !== undefined && typeof e.seq !== 'number') {
    errors.push('seq: must be a number if provided');
  }

  if (e.agent_name !== undefined && typeof e.agent_name !== 'string') {
    errors.push('agent_name: must be a string if provided');
  }

  if (e.span_id !== undefined && typeof e.span_id !== 'string') {
    errors.push('span_id: must be a string if provided');
  }

  if (e.parent_span_id !== undefined && typeof e.parent_span_id !== 'string') {
    errors.push('parent_span_id: must be a string if provided');
  }

  if (e.team_id !== undefined && typeof e.team_id !== 'string') {
    errors.push('team_id: must be a string if provided');
  }

  if (e.project_id !== undefined && typeof e.project_id !== 'string') {
    errors.push('project_id: must be a string if provided');
  }

  if (e.task_id !== undefined && typeof e.task_id !== 'string') {
    errors.push('task_id: must be a string if provided');
  }

  if (e.goal_id !== undefined && typeof e.goal_id !== 'string') {
    errors.push('goal_id: must be a string if provided');
  }

  if (e.runtime !== undefined) {
    if (!isPlainObject(e.runtime)) {
      errors.push('runtime: must be a plain object if provided');
    } else {
      if (!isNonEmptyString(e.runtime['family']) || !RUNTIME_FAMILY_SET.has(e.runtime['family'])) {
        errors.push(`runtime.family: must be one of ${AGENT_RUNTIME_FAMILIES.join(', ')}`);
      }
      if (e.runtime['orchestrator'] !== undefined
        && (typeof e.runtime['orchestrator'] !== 'string' || !ORCHESTRATOR_SET.has(e.runtime['orchestrator'])))
      {
        errors.push(`runtime.orchestrator: must be one of ${AGENT_ORCHESTRATOR_TYPES.join(', ')}`);
      }
      if (e.runtime['client'] !== undefined
        && (typeof e.runtime['client'] !== 'string' || !CLIENT_SET.has(e.runtime['client'])))
      {
        errors.push(`runtime.client: must be one of ${AGENT_CLIENT_TYPES.join(', ')}`);
      }
    }
  }

  if (e.task_context !== undefined) {
    if (!isPlainObject(e.task_context)) {
      errors.push('task_context: must be a plain object if provided');
    } else {
      const provider = e.task_context['provider'];
      if (provider !== undefined && typeof provider !== 'string') {
        errors.push('task_context.provider: must be a string if provided');
      }
      for (const key of [
        'project_id',
        'task_id',
        'goal_id',
        'issue_id',
        'issue_identifier',
        'execution_run_id',
        'checkout_run_id',
        'title',
        'status',
      ]) {
        if (!isOptionalString(e.task_context[key])) {
          errors.push(`task_context.${key}: must be a string if provided`);
        }
      }
    }
  }

  if (e.provenance !== undefined) {
    if (!isPlainObject(e.provenance)) {
      errors.push('provenance: must be a plain object if provided');
    } else {
      for (const key of [
        'collector',
        'source_event_id',
        'source_event_fingerprint',
        'source_path',
        'raw_event_type',
        'received_at',
        'dedupe_key',
        'transport',
      ]) {
        if (!isOptionalString(e.provenance[key])) {
          errors.push(`provenance.${key}: must be a string if provided`);
        }
      }
      if (e.provenance['source_offset'] !== undefined && typeof e.provenance['source_offset'] !== 'number') {
        errors.push('provenance.source_offset: must be a number if provided');
      }
      if (e.provenance['ingestion_kind'] !== undefined
        && (typeof e.provenance['ingestion_kind'] !== 'string' || !INGESTION_SET.has(e.provenance['ingestion_kind'])))
      {
        errors.push(`provenance.ingestion_kind: must be one of ${EVENT_INGESTION_KINDS.join(', ')}`);
      }
    }
  }

  if (e.data !== undefined && !isPlainObject(e.data)) {
    errors.push('data: must be a plain object if provided');
  }

  if (e.metadata !== undefined && !isPlainObject(e.metadata)) {
    errors.push('metadata: must be a plain object if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * UAEPEvent 객체를 검증하고 타입 가드로 사용한다.
 *
 * @param event - 검증할 이벤트 객체
 * @returns 유효한 UAEPEvent이면 true
 */
export function isValidUAEPEvent(event: unknown): event is UAEPEvent {
  return validateUAEPEvent(event).valid;
}
