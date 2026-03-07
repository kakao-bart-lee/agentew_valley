/**
 * Codex 파서 레코드 → UAEPEvent 변환기.
 *
 * 변환 규칙:
 *   - agent_id: "cdx-{sessionId 앞 8자}"
 *   - agent_name: "{agentNickname}" 또는 "Codex {sessionId 앞 8자}"
 *   - session_id: Codex session UUID
 *   - source: "codex"
 *   - tool.start의 span_id: call_id
 *   - tool.end에서 duration_ms: (출력 타임스탬프 - 시작 타임스탬프)
 *   - token_count → metrics.usage (턴별 delta 계산)
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId, getToolCategory } from '@agent-observatory/shared';
import type { CdxParsedRecord } from './parser.js';

/** 노멀라이저가 관리하는 세션 컨텍스트 */
export interface CdxNormalizerContext {
  /** Codex 세션 UUID */
  sessionId: string;
  /** 에이전트 ID ("cdx-{sessionId 앞 8자}") */
  agentId: string;
  /** 에이전트 표시 이름 */
  agentName: string;
  /** 시퀀스 카운터 */
  seq: number;
  /** 활성 도구 호출 시작 시각 (call_id → ISO timestamp) */
  activeToolTimestamps: Map<string, string>;
  /** 프로젝트 ID (cwd) */
  projectId?: string;
  /** 현재 세션의 LLM 모델 ID */
  modelId?: string;
  /** 직전 token_count 누적값 (delta 계산용) */
  prevTotalTokens: number;
  prevTotalInputTokens: number;
  prevTotalOutputTokens: number;
  prevTotalCachedInputTokens: number;
  /** session_meta를 이미 처리했는지 (중복 session.start 방지) */
  sessionStarted: boolean;
}

/**
 * Codex 세션 ID에서 에이전트 ID를 생성한다.
 * 예: "019cc3c8-09e1-7782-ba7a-5be9e059261f" → "cdx-019cc3c8"
 */
export function buildAgentId(sessionId: string): string {
  // UUID에서 하이픈 제거 후 앞 8자
  const clean = sessionId.replace(/-/g, '');
  return `cdx-${clean.slice(0, 8)}`;
}

/**
 * CdxNormalizerContext를 생성한다.
 */
export function createContext(
  sessionId: string,
  agentNickname?: string,
  cwd?: string,
): CdxNormalizerContext {
  const clean = sessionId.replace(/-/g, '');
  const shortId = clean.slice(0, 8);
  const agentName = agentNickname ? agentNickname : `Codex ${shortId}`;

  return {
    sessionId,
    agentId: buildAgentId(sessionId),
    agentName,
    seq: 0,
    activeToolTimestamps: new Map(),
    projectId: cwd,
    prevTotalTokens: 0,
    prevTotalInputTokens: 0,
    prevTotalOutputTokens: 0,
    prevTotalCachedInputTokens: 0,
    sessionStarted: false,
  };
}

/** 현재 시각을 ISO-8601로 반환 */
function nowISO(recordTimestamp?: string): string {
  return recordTimestamp ?? new Date().toISOString();
}

/** 공통 이벤트 envelope 생성 */
function makeEvent(
  ctx: CdxNormalizerContext,
  type: UAEPEvent['type'],
  ts: string,
  extra?: Partial<UAEPEvent>,
): UAEPEvent {
  ctx.seq++;
  return {
    ts,
    seq: ctx.seq,
    event_id: generateEventId(),
    source: 'codex',
    agent_id: ctx.agentId,
    agent_name: ctx.agentName,
    session_id: ctx.sessionId,
    ...(ctx.projectId !== undefined ? { project_id: ctx.projectId } : {}),
    ...(ctx.modelId !== undefined ? { model_id: ctx.modelId } : {}),
    type,
    ...extra,
  };
}

/**
 * function_call arguments JSON 문자열에서 input_summary를 추출한다.
 */
function extractInputSummary(argumentsJson: string): { summary: string; keys: string[] } {
  let parsed: Record<string, unknown> = {};
  try {
    const result = JSON.parse(argumentsJson);
    if (typeof result === 'object' && result !== null) {
      parsed = result as Record<string, unknown>;
    }
  } catch {
    // 파싱 실패 시 빈 객체 사용
  }

  const keys = Object.keys(parsed);
  // 첫 번째 경로/파일 관련 키에서 요약 추출
  const pathKeys = ['file_path', 'path', 'file', 'command', 'cmd', 'pattern', 'query', 'workdir'];
  for (const key of pathKeys) {
    if (typeof parsed[key] === 'string') {
      const value = parsed[key] as string;
      return {
        summary: value.length > 100 ? value.slice(0, 100) + '...' : value,
        keys,
      };
    }
  }
  return { summary: '', keys };
}

/**
 * 단일 CdxParsedRecord를 UAEPEvent 배열로 변환한다.
 */
export function normalize(
  record: CdxParsedRecord,
  ctx: CdxNormalizerContext,
): UAEPEvent[] {
  const ts = nowISO(record.timestamp);

  switch (record.kind) {
    case 'session_meta': {
      // 첫 번째 session_meta만 session.start로 변환 (파일당 하나)
      if (ctx.sessionStarted) return [];
      ctx.sessionStarted = true;

      // 컨텍스트 업데이트
      if (record.cwd) ctx.projectId = record.cwd;
      if (record.agentNickname) {
        ctx.agentName = record.agentNickname;
      }

      return [
        makeEvent(ctx, 'session.start', ts, {
          data: {
            cwd: record.cwd,
            originator: record.originator,
            model_provider: record.modelProvider,
            agent_role: record.agentRole,
            parent_thread_id: record.parentThreadId,
          },
        }),
      ];
    }

    case 'turn_context': {
      // 모델 정보 업데이트
      if (record.model) ctx.modelId = record.model;
      if (record.cwd && !ctx.projectId) ctx.projectId = record.cwd;
      return [];
    }

    case 'task_started': {
      return [
        makeEvent(ctx, 'agent.status', ts, {
          data: {
            status: 'thinking',
            turn_id: record.turnId,
            model_context_window: record.modelContextWindow,
          },
        }),
      ];
    }

    case 'task_complete': {
      return [
        makeEvent(ctx, 'agent.status', ts, {
          data: {
            status: 'idle',
            turn_id: record.turnId,
          },
        }),
      ];
    }

    case 'user_message': {
      return [
        makeEvent(ctx, 'user.input', ts, {
          data: {
            text_length: record.message.length,
          },
        }),
      ];
    }

    case 'agent_message': {
      // phase: "commentary" — 에이전트가 사용자에게 설명하는 메시지
      // 별도 이벤트 불필요 (agent.status: thinking은 task_started에서 이미 발행)
      return [];
    }

    case 'token_count': {
      // delta 계산 (누적값의 차이 = 이번 턴 사용량)
      const deltaInput = Math.max(0, record.totalInputTokens - ctx.prevTotalInputTokens);
      const deltaOutput = Math.max(0, record.totalOutputTokens - ctx.prevTotalOutputTokens);
      const deltaCachedInput = Math.max(0, record.totalCachedInputTokens - ctx.prevTotalCachedInputTokens);
      const deltaTotal = Math.max(0, record.totalTokens - ctx.prevTotalTokens);

      // 현재 누적값 저장
      ctx.prevTotalTokens = record.totalTokens;
      ctx.prevTotalInputTokens = record.totalInputTokens;
      ctx.prevTotalOutputTokens = record.totalOutputTokens;
      ctx.prevTotalCachedInputTokens = record.totalCachedInputTokens;

      if (deltaTotal === 0) return [];

      return [
        makeEvent(ctx, 'metrics.usage', ts, {
          data: {
            input_tokens: deltaInput,
            output_tokens: deltaOutput,
            cache_read_input_tokens: deltaCachedInput > 0 ? deltaCachedInput : undefined,
            tokens: deltaTotal,
            // cost는 알 수 없으므로 미포함
          },
        }),
      ];
    }

    case 'function_call': {
      ctx.activeToolTimestamps.set(record.callId, ts);
      const category = getToolCategory(record.name);
      const { summary, keys } = extractInputSummary(record.arguments);

      return [
        makeEvent(ctx, 'tool.start', ts, {
          span_id: record.callId,
          data: {
            tool_name: record.name,
            tool_category: category,
            input_summary: summary,
            input_keys: keys,
          },
        }),
      ];
    }

    case 'function_call_output': {
      const startTs = ctx.activeToolTimestamps.get(record.callId);
      let durationMs: number | undefined;
      if (startTs) {
        durationMs = new Date(ts).getTime() - new Date(startTs).getTime();
        if (durationMs < 0) durationMs = undefined;
        ctx.activeToolTimestamps.delete(record.callId);
      }

      return [
        makeEvent(ctx, 'tool.end', ts, {
          span_id: record.callId,
          data: {
            duration_ms: durationMs,
            response_length: record.output.length,
          },
        }),
      ];
    }

    default:
      return [];
  }
}

/**
 * 여러 CdxParsedRecord를 일괄 변환한다.
 */
export function normalizeAll(
  records: CdxParsedRecord[],
  ctx: CdxNormalizerContext,
): UAEPEvent[] {
  const events: UAEPEvent[] = [];
  for (const record of records) {
    events.push(...normalize(record, ctx));
  }
  return events;
}
