/**
 * Claude Code Hooks 수신 엔드포인트.
 *
 * Claude Code는 settings.json의 hooks 설정을 통해 특정 생명주기 이벤트를
 * 외부 HTTP 엔드포인트로 전송할 수 있다.
 *
 * 지원 훅:
 *   SessionStart       → session.start (model_id 포함)
 *   SessionStop / Stop → session.end   (last_assistant_message 길이 포함)
 *   PostToolUse        → tool.end      (도구 완료, 결과 메타데이터)
 *   PostToolUseFailure → tool.error    (도구 오류 상세)
 *   SubagentStart      → subagent.spawn (서브에이전트 시작 알림)
 *   SubagentStop       → subagent.end   (서브에이전트 종료 알림)
 *
 * 클라이언트 설정 예 (~/.claude/settings.json):
 * ```json
 * {
 *   "hooks": {
 *     "SessionStart": [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/v1/hooks/claude-code" }] }],
 *     "PostToolUse":        [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/v1/hooks/claude-code" }] }],
 *     "PostToolUseFailure": [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/v1/hooks/claude-code" }] }],
 *     "SubagentStart":      [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/v1/hooks/claude-code" }] }],
 *     "SubagentStop":       [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/v1/hooks/claude-code" }] }],
 *     "Stop":               [{ "hooks": [{ "type": "http", "url": "http://localhost:3000/api/v1/hooks/claude-code" }] }]
 *   }
 * }
 * ```
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateEventId } from '@agent-observatory/shared';
import type { UAEPEvent } from '@agent-observatory/shared';
import type { EventBus } from '../core/event-bus.js';

// ─── Payload 타입 정의 ───────────────────────────────────────────────────────

interface ClaudeCodeSessionStartPayload {
  type: 'SessionStart';
  /** 사용 중인 LLM 모델 ID (예: "claude-sonnet-4-6") */
  model?: string;
  source?: string;
  /** 에이전트 타입 (예: "claude_code", "subagent") */
  agent_type?: string;
  transcript_path?: string;
  session_id?: string;
}

interface ClaudeCodeSessionStopPayload {
  type: 'SessionStop' | 'Stop';
  model?: string;
  source?: string;
  transcript_path?: string;
  session_id?: string;
  /** 마지막 어시스턴트 응답 (Stop 훅에서 제공) */
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

interface ClaudeCodePostToolUsePayload {
  type: 'PostToolUse';
  tool_name?: string;
  tool_use_id?: string;
  /** 도구 입력 파라미터 (전체 값 포함 — 개인정보 보호를 위해 키만 저장) */
  tool_input?: Record<string, unknown>;
  /** 도구 실행 결과 (전체 내용은 저장하지 않고 길이만 기록) */
  tool_response?: unknown;
  transcript_path?: string;
  session_id?: string;
}

interface ClaudeCodePostToolUseFailurePayload {
  type: 'PostToolUseFailure';
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
  /** 오류 메시지 */
  error?: string;
  /** 사용자 인터럽트 여부 */
  is_interrupt?: boolean;
  transcript_path?: string;
  session_id?: string;
}

interface ClaudeCodeSubagentStartPayload {
  type: 'SubagentStart';
  /** 부모 세션 식별자 */
  session_id?: string;
  transcript_path?: string;
  /** 서브에이전트 세션/식별자 */
  agent_id?: string;
  agent_type?: string;
}

interface ClaudeCodeSubagentStopPayload {
  type: 'SubagentStop';
  /** 부모 세션 식별자 */
  session_id?: string;
  transcript_path?: string;
  /** 서브에이전트 식별자 */
  agent_id?: string;
  agent_type?: string;
  /** 서브에이전트 JSONL 경로 (session_id 추출용) */
  agent_transcript_path?: string;
  /** 서브에이전트의 마지막 응답 */
  last_assistant_message?: string;
}

type ClaudeCodeHookPayload =
  | ClaudeCodeSessionStartPayload
  | ClaudeCodeSessionStopPayload
  | ClaudeCodePostToolUsePayload
  | ClaudeCodePostToolUseFailurePayload
  | ClaudeCodeSubagentStartPayload
  | ClaudeCodeSubagentStopPayload;

// ─── 헬퍼 함수 ───────────────────────────────────────────────────────────────

/**
 * transcript_path에서 session_id를 추출한다.
 * 예: "/Users/joy/.claude/projects/-Users-joy-proj/abc123.jsonl" → "abc123"
 */
function extractSessionIdFromPath(transcriptPath: string): string | undefined {
  const fileName = transcriptPath.split('/').pop();
  if (!fileName) return undefined;
  return fileName.replace(/\.jsonl$/i, '');
}

/**
 * session_id로 agent_id를 생성한다.
 * Claude Code normalizer와 동일한 규칙: "cc-{session_id 앞 8자}"
 */
function buildAgentIdFromSessionId(sessionId: string): string {
  return `cc-${sessionId.slice(0, 8)}`;
}

/**
 * payload에서 session_id를 결정한다.
 * session_id 직접 제공 > transcript_path에서 추출 순서로 시도.
 */
function resolveSessionId(payload: {
  session_id?: string;
  transcript_path?: string;
}): string | undefined {
  return (
    payload.session_id ??
    (payload.transcript_path ? extractSessionIdFromPath(payload.transcript_path) : undefined)
  );
}

/**
 * 도구 응답 값의 길이를 안전하게 추출한다.
 * 문자열이면 길이, 객체면 JSON 문자열 길이, 기타 0 반환.
 */
function getResponseLength(toolResponse: unknown): number {
  if (typeof toolResponse === 'string') return toolResponse.length;
  if (toolResponse != null) {
    try {
      return JSON.stringify(toolResponse).length;
    } catch {
      return 0;
    }
  }
  return 0;
}

function buildHookProvenance(
  hookType: ClaudeCodeHookPayload['type'],
  payload: { transcript_path?: string; tool_use_id?: string; session_id?: string; agent_transcript_path?: string },
) {
  return {
    ingestion_kind: 'hook' as const,
    transport: 'claude_code_hook',
    raw_event_type: hookType,
    source_path: payload.agent_transcript_path ?? payload.transcript_path,
    source_event_id: payload.tool_use_id ?? payload.session_id,
  };
}

// ─── 라우터 ──────────────────────────────────────────────────────────────────

/**
 * Claude Code Hooks 라우터를 생성한다.
 *
 * POST /api/v1/hooks/claude-code 로 Claude Code 훅 이벤트를 수신하여
 * EventBus를 통해 내부 시스템으로 전파한다.
 */
export function createHooksRouter(eventBus: EventBus): Router {
  const router = Router();

  router.post('/api/v1/hooks/claude-code', (req: Request, res: Response) => {
    const body = req.body as ClaudeCodeHookPayload;
    if (!body || typeof (body as { type?: unknown }).type !== 'string') {
      res.status(400).json({ error: 'Invalid hook payload: missing type' });
      return;
    }

    const now = new Date().toISOString();

    switch (body.type) {
      // ── SessionStart ──────────────────────────────────────────────────────
      case 'SessionStart': {
        const payload = body as ClaudeCodeSessionStartPayload;
        const rawSessionId = resolveSessionId(payload);

        if (!rawSessionId) {
          res.status(400).json({ error: 'Cannot determine session_id from payload' });
          return;
        }

        const agentId = buildAgentIdFromSessionId(rawSessionId);
        const modelId = payload.model;

        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: agentId,
          session_id: rawSessionId,
          ...(modelId ? { model_id: modelId } : {}),
          type: 'session.start',
          provenance: buildHookProvenance(body.type, {
            transcript_path: payload.transcript_path,
            session_id: rawSessionId,
          }),
          data: {
            model_id: modelId,
            agent_type: payload.agent_type,
            from_hook: true,
          },
        };

        eventBus.publish(event);
        console.log(
          `[hooks] SessionStart: agent=${agentId} session=${rawSessionId} model=${modelId ?? 'unknown'}`,
        );
        res.status(200).json({ status: 'accepted', session_id: rawSessionId });
        break;
      }

      // ── SessionStop / Stop ────────────────────────────────────────────────
      case 'SessionStop':
      case 'Stop': {
        const payload = body as ClaudeCodeSessionStopPayload;
        const rawSessionId = resolveSessionId(payload);

        if (!rawSessionId) {
          // session_id 없어도 조용히 수락 (선택적 훅)
          res.status(200).json({ status: 'accepted' });
          return;
        }

        const agentId = buildAgentIdFromSessionId(rawSessionId);
        const lastMsgLen = payload.last_assistant_message?.length ?? 0;

        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: agentId,
          session_id: rawSessionId,
          type: 'session.end',
          provenance: buildHookProvenance(body.type, {
            transcript_path: payload.transcript_path,
            session_id: rawSessionId,
          }),
          data: {
            from_hook: true,
            ...(lastMsgLen > 0 ? { last_assistant_message_length: lastMsgLen } : {}),
            ...(payload.stop_hook_active !== undefined
              ? { stop_hook_active: payload.stop_hook_active }
              : {}),
          },
        };

        eventBus.publish(event);
        console.log(`[hooks] SessionStop: agent=${agentId} session=${rawSessionId}`);
        res.status(200).json({ status: 'accepted', session_id: rawSessionId });
        break;
      }

      // ── PostToolUse ───────────────────────────────────────────────────────
      case 'PostToolUse': {
        const payload = body as ClaudeCodePostToolUsePayload;
        const rawSessionId = resolveSessionId(payload);

        if (!rawSessionId) {
          // session_id 없으면 조용히 수락
          res.status(200).json({ status: 'accepted' });
          return;
        }

        const agentId = buildAgentIdFromSessionId(rawSessionId);
        const toolName = payload.tool_name ?? 'unknown';
        // 개인정보 보호: 도구 입력 값은 저장하지 않고 키 이름만 기록
        const inputKeys = payload.tool_input ? Object.keys(payload.tool_input) : [];
        const responseLength = getResponseLength(payload.tool_response);

        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: agentId,
          session_id: rawSessionId,
          type: 'tool.end',
          provenance: buildHookProvenance(body.type, {
            transcript_path: payload.transcript_path,
            tool_use_id: payload.tool_use_id,
            session_id: rawSessionId,
          }),
          data: {
            tool_name: toolName,
            tool_use_id: payload.tool_use_id,
            input_keys: inputKeys,
            response_length: responseLength,
            from_hook: true,
          },
        };

        eventBus.publish(event);
        console.log(
          `[hooks] PostToolUse: agent=${agentId} tool=${toolName} response_len=${responseLength}`,
        );
        res.status(200).json({ status: 'accepted' });
        break;
      }

      // ── PostToolUseFailure ────────────────────────────────────────────────
      case 'PostToolUseFailure': {
        const payload = body as ClaudeCodePostToolUseFailurePayload;
        const rawSessionId = resolveSessionId(payload);

        if (!rawSessionId) {
          res.status(200).json({ status: 'accepted' });
          return;
        }

        const agentId = buildAgentIdFromSessionId(rawSessionId);
        const toolName = payload.tool_name ?? 'unknown';
        const inputKeys = payload.tool_input ? Object.keys(payload.tool_input) : [];

        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: agentId,
          session_id: rawSessionId,
          type: 'tool.error',
          provenance: buildHookProvenance(body.type, {
            transcript_path: payload.transcript_path,
            tool_use_id: payload.tool_use_id,
            session_id: rawSessionId,
          }),
          data: {
            tool_name: toolName,
            tool_use_id: payload.tool_use_id,
            input_keys: inputKeys,
            error: payload.error,
            is_interrupt: payload.is_interrupt ?? false,
            from_hook: true,
          },
        };

        eventBus.publish(event);
        console.log(
          `[hooks] PostToolUseFailure: agent=${agentId} tool=${toolName} error=${payload.error ?? 'unknown'}`,
        );
        res.status(200).json({ status: 'accepted' });
        break;
      }

      // ── SubagentStart ─────────────────────────────────────────────────────
      case 'SubagentStart': {
        const payload = body as ClaudeCodeSubagentStartPayload;
        const parentSessionId = resolveSessionId(payload);

        if (!parentSessionId) {
          res.status(200).json({ status: 'accepted' });
          return;
        }

        const parentAgentId = buildAgentIdFromSessionId(parentSessionId);
        const childAgentId = payload.agent_id;

        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: parentAgentId,
          session_id: parentSessionId,
          type: 'subagent.spawn',
          provenance: buildHookProvenance(body.type, {
            transcript_path: payload.transcript_path,
            session_id: parentSessionId,
          }),
          data: {
            child_agent_id: childAgentId,
            agent_type: payload.agent_type,
            from_hook: true,
          },
        };

        eventBus.publish(event);
        console.log(
          `[hooks] SubagentStart: parent=${parentAgentId} child=${childAgentId ?? 'unknown'} type=${payload.agent_type ?? 'unknown'}`,
        );
        res.status(200).json({ status: 'accepted' });
        break;
      }

      // ── SubagentStop ──────────────────────────────────────────────────────
      case 'SubagentStop': {
        const payload = body as ClaudeCodeSubagentStopPayload;
        const parentSessionId = resolveSessionId(payload);

        if (!parentSessionId) {
          res.status(200).json({ status: 'accepted' });
          return;
        }

        const parentAgentId = buildAgentIdFromSessionId(parentSessionId);
        const childAgentId = payload.agent_id;
        const lastMsgLen = payload.last_assistant_message?.length ?? 0;

        // 서브에이전트 세션 ID: agent_transcript_path에서 추출
        const childSessionId = payload.agent_transcript_path
          ? extractSessionIdFromPath(payload.agent_transcript_path)
          : childAgentId;

        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: parentAgentId,
          session_id: parentSessionId,
          type: 'subagent.end',
          provenance: buildHookProvenance(body.type, {
            transcript_path: payload.transcript_path,
            agent_transcript_path: payload.agent_transcript_path,
            session_id: parentSessionId,
          }),
          data: {
            child_agent_id: childAgentId,
            child_session_id: childSessionId,
            agent_type: payload.agent_type,
            ...(lastMsgLen > 0 ? { last_assistant_message_length: lastMsgLen } : {}),
            from_hook: true,
          },
        };

        eventBus.publish(event);
        console.log(
          `[hooks] SubagentStop: parent=${parentAgentId} child=${childAgentId ?? 'unknown'}`,
        );
        res.status(200).json({ status: 'accepted' });
        break;
      }

      // ── 알려지지 않은 훅 타입 ─────────────────────────────────────────────
      default: {
        // 하위 호환성: 미래 훅 타입을 조용히 수락
        res.status(200).json({ status: 'accepted' });
        break;
      }
    }
  });

  return router;
}
