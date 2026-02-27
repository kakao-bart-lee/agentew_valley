/**
 * OpenClaw 파서 레코드 -> UAEPEvent 변환기.
 *
 * 변환 규칙:
 *   - agent_id: "oc-{agentId 앞 8자}"
 *   - agent_name: "OpenClaw {agentId}"
 *   - session_id: OpenClaw의 sessionId
 *   - source: "openclaw"
 *   - 도구명 매핑: getToolCategory() (알 수 없으면 "other")
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId, getToolCategory } from '@agent-observatory/shared';
import type { OCParsedRecord, OCSessionHeader } from './parser.js';

/** 노멀라이저가 관리하는 세션 컨텍스트 */
export interface OCNormalizerContext {
  /** 세션 ID */
  sessionId: string;
  /** 에이전트 ID ("oc-{agentId 앞 8자}") */
  agentId: string;
  /** 에이전트 표시 이름 */
  agentName: string;
  /** 시퀀스 카운터 */
  seq: number;
  /** 활성 도구 시작 시각 (id -> ISO timestamp) */
  activeToolTimestamps: Map<string, string>;
}

/**
 * agentId에서 에이전트 ID를 생성한다.
 */
export function buildAgentId(agentId: string): string {
  return `oc-${agentId.slice(0, 8)}`;
}

/**
 * OCNormalizerContext를 생성한다.
 */
export function createContext(
  agentId: string,
  sessionId: string = '',
): OCNormalizerContext {
  return {
    sessionId,
    agentId: buildAgentId(agentId),
    agentName: `OpenClaw ${agentId.slice(0, 8)}`,
    seq: 0,
    activeToolTimestamps: new Map(),
  };
}

/**
 * session header에서 컨텍스트를 업데이트한다.
 */
export function updateContextFromHeader(
  ctx: OCNormalizerContext,
  header: OCSessionHeader,
): void {
  ctx.sessionId = header.sessionId;
}

/** 현재 시각을 ISO-8601로 반환 */
function nowISO(recordTimestamp?: string): string {
  return recordTimestamp ?? new Date().toISOString();
}

/** 공통 이벤트 envelope 생성 */
function makeEvent(
  ctx: OCNormalizerContext,
  type: UAEPEvent['type'],
  ts: string,
  extra?: Partial<UAEPEvent>,
): UAEPEvent {
  ctx.seq++;
  return {
    ts,
    seq: ctx.seq,
    event_id: generateEventId(),
    source: 'openclaw',
    agent_id: ctx.agentId,
    agent_name: ctx.agentName,
    session_id: ctx.sessionId,
    type,
    ...extra,
  };
}

/**
 * tool input에서 짧은 요약을 생성한다.
 */
function summarizeInput(input: Record<string, unknown>): string {
  const pathKey = ['file_path', 'path', 'file', 'command', 'pattern', 'query'];
  for (const key of pathKey) {
    if (typeof input[key] === 'string') {
      const value = input[key] as string;
      return value.length > 100 ? value.slice(0, 100) + '...' : value;
    }
  }
  return '';
}

/**
 * 단일 OCParsedRecord를 UAEPEvent 배열로 변환한다.
 */
export function normalize(
  record: OCParsedRecord,
  ctx: OCNormalizerContext,
): UAEPEvent[] {
  const ts = nowISO(record.timestamp);

  switch (record.kind) {
    case 'session_header': {
      updateContextFromHeader(ctx, record);
      return [
        makeEvent(ctx, 'session.start', ts, {
          data: {
            version: record.version,
            cwd: record.cwd,
          },
        }),
      ];
    }

    case 'tool_call': {
      ctx.activeToolTimestamps.set(record.id, ts);
      const category = getToolCategory(record.name);
      const summary = summarizeInput(record.input);

      return [
        makeEvent(ctx, 'tool.start', ts, {
          span_id: record.id,
          data: {
            tool_name: record.name,
            tool_category: category,
            input_summary: summary,
          },
        }),
      ];
    }

    case 'tool_result': {
      const startTs = ctx.activeToolTimestamps.get(record.toolCallId);
      let durationMs: number | undefined;
      if (startTs) {
        durationMs = new Date(ts).getTime() - new Date(startTs).getTime();
        if (durationMs < 0) durationMs = undefined;
        ctx.activeToolTimestamps.delete(record.toolCallId);
      }

      if (record.isError) {
        return [
          makeEvent(ctx, 'tool.error', ts, {
            span_id: record.toolCallId,
            data: {
              duration_ms: durationMs,
              error: record.content?.slice(0, 200),
            },
          }),
        ];
      }

      return [
        makeEvent(ctx, 'tool.end', ts, {
          span_id: record.toolCallId,
          data: {
            duration_ms: durationMs,
          },
        }),
      ];
    }

    case 'user_input': {
      return [
        makeEvent(ctx, 'user.input', ts, {
          data: {
            text_length: record.text.length,
          },
        }),
      ];
    }

    default:
      return [];
  }
}

/**
 * 여러 OCParsedRecord를 일괄 변환한다.
 */
export function normalizeAll(
  records: OCParsedRecord[],
  ctx: OCNormalizerContext,
): UAEPEvent[] {
  const events: UAEPEvent[] = [];
  for (const record of records) {
    events.push(...normalize(record, ctx));
  }
  return events;
}
