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
  /**
   * 서브에이전트 컨텍스트 캐시 (parentToolUseId → NormalizerContext).
   * 동일 parentToolUseId의 progress가 여러 번 올 때 컨텍스트를 재사용하여
   * session.start/subagent.spawn이 중복 발행되지 않도록 한다.
   */
  subContexts: Map<string, NormalizerContext>;
  /** 프로젝트 ID (JSONL 파일 경로의 projects/ 하위 디렉토리명) */
  projectId?: string;
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
 * JSONL 파일 경로에서 프로젝트 ID를 추출한다.
 *
 * Claude Code는 ~/.claude/projects/{project-dir}/{session-uuid}.jsonl 구조를 사용.
 * {project-dir}은 작업 디렉토리의 절대 경로에서 `/`를 `-`로 치환한 값이다.
 *
 * 예: /Users/joy/.claude/projects/-Users-joy-workspace-my-repo/abc.jsonl
 *     → "-Users-joy-workspace-my-repo"
 */
export function extractProjectId(filePath: string): string | undefined {
  const parts = filePath.split('/');
  const projectsIdx = parts.lastIndexOf('projects');
  if (projectsIdx >= 0 && parts[projectsIdx + 1]) {
    return parts[projectsIdx + 1];
  }
  // fallback: parent directory name
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
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
    subContexts: new Map(),
    projectId: extractProjectId(filePath),
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
    ...(ctx.projectId !== undefined ? { project_id: ctx.projectId } : {}),
    type,
    ...extra,
  };
}

/**
 * tool_use input에서 짧은 요약을 생성한다.
 * 민감 데이터 노출 방지를 위해 최소 정보만 포함.
 */
function summarizeInput(
  _toolName: string,
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

      const events: UAEPEvent[] = [];

      // Task 도구가 완료되면 해당 서브에이전트 session.end 발행 후 컨텍스트 정리
      if (ctx.subContexts.has(record.toolUseId)) {
        const subCtx = ctx.subContexts.get(record.toolUseId)!;
        events.push(makeEvent(subCtx, 'session.end', ts));
        ctx.subContexts.delete(record.toolUseId);
      }

      if (record.isError) {
        events.push(
          makeEvent(ctx, 'tool.error', ts, {
            span_id: record.toolUseId,
            data: {
              duration_ms: durationMs,
              error: record.content?.slice(0, 200),
            },
          }),
        );
        return events;
      }

      events.push(
        makeEvent(ctx, 'tool.end', ts, {
          span_id: record.toolUseId,
          data: {
            duration_ms: durationMs,
          },
        }),
      );
      return events;
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

    case 'usage': {
      return [
        makeEvent(ctx, 'metrics.usage', ts, {
          data: {
            tokens: record.inputTokens + record.outputTokens,
            input_tokens: record.inputTokens,
            output_tokens: record.outputTokens,
            ...(record.costUsd !== undefined ? { cost: record.costUsd } : {}),
          },
        }),
      ];
    }

    case 'subagent_progress': {
      const events: UAEPEvent[] = [];
      const isFirstProgress = !ctx.subContexts.has(record.parentToolUseId);

      // 서브에이전트 컨텍스트 get-or-create
      if (isFirstProgress) {
        const subIdx = ctx.subContexts.size + 1;
        const subAgentId = `${ctx.agentId}-s${subIdx}`;
        const subSessionId = `${ctx.sessionId}-s${subIdx}`;
        const subCtx: NormalizerContext = {
          sessionId: subSessionId,
          agentId: subAgentId,
          agentName: `${ctx.agentName} (sub ${subIdx})`,
          seq: 0,
          activeToolTimestamps: new Map(),
          subContexts: new Map(),
          projectId: ctx.projectId, // 부모 프로젝트 상속
        };
        ctx.subContexts.set(record.parentToolUseId, subCtx);

        // 첫 progress: 부모에 subagent.spawn, 서브에이전트에 session.start
        events.push(
          makeEvent(ctx, 'subagent.spawn', ts, {
            parent_span_id: record.parentToolUseId,
            data: {
              parent_tool_use_id: record.parentToolUseId,
              child_agent_id: subAgentId,
            },
          }),
        );
        events.push(
          makeEvent(subCtx, 'session.start', ts, {
            data: {
              parent_agent_id: ctx.agentId,
              parent_tool_use_id: record.parentToolUseId,
            },
          }),
        );
      }

      // 서브에이전트 컨텍스트로 중첩 레코드 정규화
      const subCtx = ctx.subContexts.get(record.parentToolUseId)!;
      for (const nested of record.nestedRecords) {
        events.push(...normalize(nested, subCtx));
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
