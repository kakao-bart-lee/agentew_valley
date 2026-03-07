/**
 * OpenClaw 파서 레코드 → UAEPEvent 변환기.
 *
 * 변환 규칙:
 *   - agent_id: "oc-{agentId 앞 8자}"
 *   - agent_name: "OpenClaw {agentId}"
 *   - session_id: OpenClaw의 sessionId
 *   - source: "openclaw"
 *   - 도구명 매핑: getToolCategory() (알 수 없으면 "other")
 *   - model_id: assistant_message에서 추출, 이후 이벤트에 전파
 */

import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId, getToolCategory } from '@agent-observatory/shared';
import type { OCParsedRecord, OCSessionHeader, OCModelChange, OCCustomRecord } from './parser.js';

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
  /** 활성 도구 시작 시각 (id → ISO timestamp) */
  activeToolTimestamps: Map<string, string>;
  /** 프로젝트 ID (세션 헤더의 cwd) */
  projectId?: string;
  /** 현재 세션에서 확인된 LLM 모델 ID */
  modelId?: string;
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
 * model_change 레코드에서 컨텍스트를 업데이트한다.
 */
export function updateContextFromModelChange(
  ctx: OCNormalizerContext,
  change: OCModelChange,
): void {
  ctx.modelId = change.modelId;
}

/**
 * custom 레코드(model-snapshot, cache-ttl)에서 모델 컨텍스트를 업데이트한다.
 */
export function updateContextFromCustom(
  ctx: OCNormalizerContext,
  record: OCCustomRecord,
): void {
  if (record.modelId) {
    ctx.modelId = record.modelId;
  }
}

/**
 * session header에서 컨텍스트를 업데이트한다.
 */
export function updateContextFromHeader(
  ctx: OCNormalizerContext,
  header: OCSessionHeader,
): void {
  ctx.sessionId = header.sessionId;
  ctx.projectId = header.cwd; // 세션 헤더의 cwd를 프로젝트 ID로 사용
  if (header.model) {
    ctx.modelId = header.model;
  }
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
    ...(ctx.projectId !== undefined ? { project_id: ctx.projectId } : {}),
    ...(ctx.modelId !== undefined ? { model_id: ctx.modelId } : {}),
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
            input_keys: Object.keys(record.input),
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
            response_length: record.content?.length ?? 0,
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

    case 'model_change': {
      // 세션 시작 직후 모델 정보를 컨텍스트에 반영 (이후 이벤트에 model_id 전파)
      updateContextFromModelChange(ctx, record);
      return [];
    }

    case 'custom': {
      if (
        record.customType === 'model-snapshot' ||
        record.customType === 'openclaw.cache-ttl'
      ) {
        // 모델 컨텍스트만 업데이트, 이벤트 미발행
        updateContextFromCustom(ctx, record);
        return [];
      }

      if (record.customType === 'openclaw:prompt-error') {
        // LLM 호출 실패 → tool.error 이벤트
        if (record.modelId) ctx.modelId = record.modelId;
        return [
          makeEvent(ctx, 'tool.error', ts, {
            data: {
              error: record.error ?? 'prompt-error',
              model_id: record.modelId ?? ctx.modelId,
              provider: record.provider,
            },
          }),
        ];
      }

      return [];
    }

    case 'assistant_message': {
      const events: UAEPEvent[] = [];

      // 모델 정보 업데이트 (이후 이벤트에 전파)
      if (record.model) {
        ctx.modelId = record.model;
      }

      // 텍스트 응답이 있으면 llm.end 이벤트 발행
      if (record.textLength > 0) {
        events.push(
          makeEvent(ctx, 'llm.end', ts, {
            data: {
              text_length: record.textLength,
              model_id: record.model ?? ctx.modelId,
            },
          }),
        );
      }

      // 토큰 사용량이 있으면 metrics.usage 이벤트 발행
      if (record.usage) {
        const {
          input_tokens,
          output_tokens,
          cache_creation_input_tokens,
          cache_read_input_tokens,
          cost_usd,  // OpenClaw가 직접 제공하는 비용
        } = record.usage;
        const totalTokens = input_tokens + output_tokens;

        events.push(
          makeEvent(ctx, 'metrics.usage', ts, {
            data: {
              input_tokens,
              output_tokens,
              tokens: totalTokens,
              ...(cache_creation_input_tokens !== undefined
                ? { cache_creation_input_tokens }
                : {}),
              ...(cache_read_input_tokens !== undefined
                ? { cache_read_input_tokens }
                : {}),
              // cost_usd가 있으면 모델 가격표 계산 없이 직접 사용
              ...(cost_usd !== undefined ? { cost_usd } : {}),
              model_id: record.model ?? ctx.modelId,
            },
          }),
        );
      }

      return events;
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
