/**
 * Claude Code 파서 레코드 -> UAEPEvent 변환기.
 *
 * 변환 규칙:
 *   - agent_id: "cc-{세션파일 UUID 앞 8자}"
 *   - agent_name: "Claude Code #{순번}"
 *   - session_id: JSONL 파일명(UUID)
 *   - source: "claude_code"
 *   - tool.start의 span_id: tool_use.id
 *   - tool.end에서 duration_ms 계산 (start-end 타임스탬프)
 *   - tool_category: getToolCategory(tool_name)
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId, getToolCategory } from '@agent-observatory/shared';
import type { CCParsedRecord } from './parser.js';

/** 노멀라이저가 관리하는 세션 컨텍스트 */
export interface NormalizerContext {
  /** 세션 ID (JSONL 파일명에서 추출한 UUID) */
  sessionId: string;
  /** 에이전트 ID ("cc-{UUID 앞 8자}") */
  agentId: string;
  /** 에이전트 표시 이름 */
  agentName: string;
  /** 시퀀스 카운터 */
  seq: number;
  /** 활성 도구 시작 시각 (span_id -> ISO timestamp) */
  activeToolTimestamps: Map<string, string>;
}

/**
 * JSONL 파일 경로에서 세션 ID를 추출한다.
 * 경로의 마지막 세그먼트에서 .jsonl 확장자를 제거.
 */
export function extractSessionId(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  return fileName.replace(/\.jsonl$/i, '');
}

/**
 * 세션 ID에서 에이전트 ID를 생성한다.
 * "cc-{UUID 앞 8자}"
 */
export function buildAgentId(sessionId: string): string {
  return `cc-${sessionId.slice(0, 8)}`;
}

/**
 * NormalizerContext를 생성한다.
 */
export function createContext(
  filePath: string,
  agentIndex: number = 1,
): NormalizerContext {
  const sessionId = extractSessionId(filePath);
  return {
    sessionId,
    agentId: buildAgentId(sessionId),
    agentName: `Claude Code #${agentIndex}`,
    seq: 0,
    activeToolTimestamps: new Map(),
  };
}

/** 현재 시각을 ISO-8601로 반환 */
function nowISO(recordTimestamp?: string): string {
  return recordTimestamp ?? new Date().toISOString();
}

/** 공통 이벤트 envelope 생성 */
function makeEvent(
  ctx: NormalizerContext,
  type: UAEPEvent['type'],
  ts: string,
  extra?: Partial<UAEPEvent>,
): UAEPEvent {
  ctx.seq++;
  return {
    ts,
    seq: ctx.seq,
    event_id: generateEventId(),
    source: 'claude_code',
    agent_id: ctx.agentId,
    agent_name: ctx.agentName,
    session_id: ctx.sessionId,
    type,
    ...extra,
  };
}

/**
 * tool_use input에서 짧은 요약을 생성한다.
 * 민감 데이터 노출 방지를 위해 최소 정보만 포함.
 */
function summarizeInput(
  toolName: string,
  input: Record<string, unknown>,
): string {
  // 일반적인 파일 경로 키
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
 * 단일 CCParsedRecord를 UAEPEvent 배열로 변환한다.
 */
export function normalize(
  record: CCParsedRecord,
  ctx: NormalizerContext,
): UAEPEvent[] {
  const ts = nowISO(record.timestamp);

  switch (record.kind) {
    case 'tool_use': {
      ctx.activeToolTimestamps.set(record.id, ts);
      const category = getToolCategory(record.name);
      const summary = summarizeInput(record.name, record.input);

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
      const startTs = ctx.activeToolTimestamps.get(record.toolUseId);
      let durationMs: number | undefined;
      if (startTs) {
        durationMs = new Date(ts).getTime() - new Date(startTs).getTime();
        if (durationMs < 0) durationMs = undefined;
        ctx.activeToolTimestamps.delete(record.toolUseId);
      }

      if (record.isError) {
        return [
          makeEvent(ctx, 'tool.error', ts, {
            span_id: record.toolUseId,
            data: {
              duration_ms: durationMs,
              error: record.content?.slice(0, 200),
            },
          }),
        ];
      }

      return [
        makeEvent(ctx, 'tool.end', ts, {
          span_id: record.toolUseId,
          data: {
            duration_ms: durationMs,
          },
        }),
      ];
    }

    case 'turn_duration': {
      return [
        makeEvent(ctx, 'agent.status', ts, {
          data: {
            status: 'idle',
            duration_ms: record.durationMs,
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

    case 'subagent_progress': {
      const events: UAEPEvent[] = [];

      // subagent.spawn 이벤트
      events.push(
        makeEvent(ctx, 'subagent.spawn', ts, {
          parent_span_id: record.parentToolUseId,
          data: {
            parent_tool_use_id: record.parentToolUseId,
          },
        }),
      );

      // 중첩 레코드를 재귀적으로 정규화
      for (const nested of record.nestedRecords) {
        events.push(...normalize(nested, ctx));
      }

      return events;
    }

    default:
      return [];
  }
}

/**
 * 여러 CCParsedRecord를 일괄 변환한다.
 */
export function normalizeAll(
  records: CCParsedRecord[],
  ctx: NormalizerContext,
): UAEPEvent[] {
  const events: UAEPEvent[] = [];
  for (const record of records) {
    events.push(...normalize(record, ctx));
  }
  return events;
}
