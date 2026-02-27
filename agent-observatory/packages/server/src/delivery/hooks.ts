/**
 * Claude Code Hooks 수신 엔드포인트.
 *
 * Claude Code는 settings.json의 hooks 설정을 통해 특정 생명주기 이벤트를
 * 외부 HTTP 엔드포인트로 전송할 수 있다.
 *
 * 현재 지원하는 훅:
 *   - SessionStart: 세션 시작 시 model, transcript_path 등을 포함
 *   - SessionStop:  세션 종료 시 발행
 *   - PostToolUse:  도구 호출 완료 후 발행 (향후 확장용)
 *
 * 클라이언트 설정 예 (~/.claude/settings.json):
 * ```json
 * {
 *   "hooks": {
 *     "SessionStart": [{
 *       "matcher": ".*",
 *       "hooks": [{
 *         "type": "command",
 *         "command": "curl -s -X POST http://localhost:3000/api/v1/hooks/claude-code -H 'Content-Type: application/json' -d @-"
 *       }]
 *     }]
 *   }
 * }
 * ```
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateEventId } from '@agent-observatory/shared';
import type { UAEPEvent } from '@agent-observatory/shared';
import type { EventBus } from '../core/event-bus.js';

/**
 * Claude Code SessionStart 훅 페이로드.
 * Claude Code가 훅 핸들러로 전달하는 JSON 구조.
 */
interface ClaudeCodeSessionStartPayload {
  /** 훅 이벤트 종류 */
  type: 'SessionStart';
  /** 사용 중인 LLM 모델 ID (예: "claude-sonnet-4-6") */
  model?: string;
  /** 에이전트 소스 타입 */
  source?: string;
  /** 에이전트 타입 (예: "claude_code", "subagent") */
  agent_type?: string;
  /** 세션 JSONL 파일 경로. session_id 추출에 사용. */
  transcript_path?: string;
  /** 세션 ID (transcript_path에서 추출하거나 직접 제공) */
  session_id?: string;
}

/**
 * Claude Code SessionStop 훅 페이로드.
 */
interface ClaudeCodeSessionStopPayload {
  type: 'SessionStop' | 'Stop';
  model?: string;
  source?: string;
  transcript_path?: string;
  session_id?: string;
}

/**
 * Claude Code PostToolUse 훅 페이로드.
 */
interface ClaudeCodePostToolUsePayload {
  type: 'PostToolUse';
  model?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  transcript_path?: string;
  session_id?: string;
}

type ClaudeCodeHookPayload =
  | ClaudeCodeSessionStartPayload
  | ClaudeCodeSessionStopPayload
  | ClaudeCodePostToolUsePayload;

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
 * transcript_path에서 agent_id를 생성한다.
 * Claude Code normalizer와 동일한 규칙: "cc-{session_id 앞 8자}"
 */
function buildAgentIdFromSessionId(sessionId: string): string {
  return `cc-${sessionId.slice(0, 8)}`;
}

/**
 * Claude Code Hooks 라우터를 생성한다.
 *
 * POST /api/v1/hooks/claude-code 로 Claude Code 훅 이벤트를 수신하여
 * EventBus를 통해 내부 시스템으로 전파한다.
 */
export function createHooksRouter(eventBus: EventBus): Router {
  const router = Router();

  /**
   * POST /api/v1/hooks/claude-code
   *
   * Claude Code의 훅 이벤트를 수신한다. 모델 정보 등 JSONL 파일에는
   * 없는 세션 메타데이터를 주입하는 데 사용된다.
   */
  router.post('/api/v1/hooks/claude-code', (req: Request, res: Response) => {
    const body = req.body as ClaudeCodeHookPayload;
    if (!body || typeof body.type !== 'string') {
      res.status(400).json({ error: 'Invalid hook payload: missing type' });
      return;
    }

    const now = new Date().toISOString();

    switch (body.type) {
      case 'SessionStart': {
        const payload = body as ClaudeCodeSessionStartPayload;
        const rawSessionId =
          payload.session_id ??
          (payload.transcript_path
            ? extractSessionIdFromPath(payload.transcript_path)
            : undefined);

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

      case 'SessionStop':
      case 'Stop': {
        const payload = body as ClaudeCodeSessionStopPayload;
        const rawSessionId =
          payload.session_id ??
          (payload.transcript_path
            ? extractSessionIdFromPath(payload.transcript_path)
            : undefined);

        if (!rawSessionId) {
          // session_id 없어도 조용히 수락 (선택적 훅)
          res.status(200).json({ status: 'accepted' });
          return;
        }

        const agentId = buildAgentIdFromSessionId(rawSessionId);
        const event: UAEPEvent = {
          ts: now,
          event_id: generateEventId(),
          source: 'claude_code',
          agent_id: agentId,
          session_id: rawSessionId,
          type: 'session.end',
          data: { from_hook: true },
        };

        eventBus.publish(event);
        console.log(
          `[hooks] SessionStop: agent=${agentId} session=${rawSessionId}`,
        );
        res.status(200).json({ status: 'accepted', session_id: rawSessionId });
        break;
      }

      case 'PostToolUse': {
        // 향후 확장: 도구 호출 결과를 통한 실시간 메트릭 보강
        // 현재는 조용히 수락
        res.status(200).json({ status: 'accepted' });
        break;
      }

      default: {
        // 알려지지 않은 훅 타입은 조용히 수락 (하위 호환성)
        res.status(200).json({ status: 'accepted' });
        break;
      }
    }
  });

  return router;
}
