/**
 * Agent SDK Hook Collector.
 *
 * Claude Code hook 페이로드를 HTTP POST로 수신하여
 * UAEP 이벤트로 변환하는 Express Router 기반 Collector.
 */

import { Router } from 'express';
import type { UAEPEvent, UAEPEventType } from '@agent-observatory/shared';
import { generateEventId, getToolCategory } from '@agent-observatory/shared';
import type { Collector } from '../base.js';

/** Agent SDK Collector 설정 */
export interface AgentSDKCollectorConfig {
  // Router 기반이므로 watchPaths 불필요
}

/**
 * Agent SDK Hook Collector.
 *
 * Express Router를 통해 Claude Code hook 페이로드를 수신하고,
 * UAEP 이벤트로 변환하여 등록된 핸들러에 전달한다.
 *
 * 사용법:
 * ```typescript
 * const collector = new AgentSDKCollector();
 * collector.onEvent((event) => eventBus.publish(event));
 * app.use(collector.getRouter());
 * ```
 */
export class AgentSDKCollector implements Collector {
  readonly name = 'AgentSDKCollector';
  readonly sourceType = 'agent_sdk' as const;
  private handler: ((event: UAEPEvent) => void) | null = null;

  constructor(_config?: AgentSDKCollectorConfig) {}

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    // No-op — Router는 외부에서 마운트
  }

  async stop(): Promise<void> {
    // No-op
  }

  /**
   * Express Router를 반환한다.
   *
   * POST /api/v1/hooks/sdk 엔드포인트를 제공하며,
   * hook 페이로드를 UAEP 이벤트로 변환하여 핸들러에 전달한다.
   */
  getRouter(): Router {
    const router = Router();

    router.post('/api/v1/hooks/sdk', (req, res) => {
      const payload = req.body as Record<string, unknown> | undefined;
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      const event = this.convertHookToUAEP(payload);
      if (event && this.handler) {
        this.handler(event);
      }

      res.status(200).json({ status: 'ok' });
    });

    return router;
  }

  /**
   * Claude Code hook 페이로드를 UAEP 이벤트로 변환한다.
   *
   * 지원하는 hook:
   * - PreToolUse  -> tool.start
   * - PostToolUse -> tool.end
   * - Notification -> agent.status
   * - Stop -> session.end
   *
   * 알 수 없는 hook은 null을 반환한다.
   */
  private convertHookToUAEP(payload: Record<string, unknown>): UAEPEvent | null {
    const hookName = payload.hook_name as string | undefined;
    const sessionId = (payload.session_id as string) ?? 'unknown-session';
    const agentId = (payload.agent_id as string) ?? `sdk-${sessionId.slice(0, 8)}`;
    const ts = (payload.timestamp as string) ?? new Date().toISOString();

    let type: UAEPEventType;
    let data: Record<string, unknown> = {};
    let spanId: string | undefined;

    switch (hookName) {
      case 'PreToolUse': {
        type = 'tool.start';
        const toolName = (payload.tool_name as string) ?? 'unknown';
        const toolInput = payload.tool_input;
        spanId = (payload.tool_use_id as string) ?? generateEventId(new Date(ts).getTime());
        data = {
          tool_name: toolName,
          tool_category: getToolCategory(toolName),
          input_summary:
            typeof toolInput === 'string'
              ? toolInput.slice(0, 200)
              : JSON.stringify(toolInput ?? '').slice(0, 200),
        };
        break;
      }
      case 'PostToolUse': {
        type = 'tool.end';
        const toolName = (payload.tool_name as string) ?? 'unknown';
        spanId = (payload.tool_use_id as string) ?? undefined;
        data = {
          tool_name: toolName,
          duration_ms: typeof payload.duration_ms === 'number' ? payload.duration_ms : undefined,
          output_summary:
            typeof payload.tool_output === 'string'
              ? payload.tool_output.slice(0, 200)
              : undefined,
        };
        break;
      }
      case 'Notification': {
        type = 'agent.status';
        data = {
          status: (payload.status as string) ?? 'idle',
          message: (payload.message as string) ?? '',
        };
        break;
      }
      case 'Stop': {
        type = 'session.end';
        data = {
          reason: (payload.reason as string) ?? 'stopped',
        };
        break;
      }
      default:
        // 알 수 없는 hook은 무시
        return null;
    }

    return {
      ts,
      event_id: generateEventId(new Date(ts).getTime()),
      source: 'agent_sdk',
      agent_id: agentId,
      session_id: sessionId,
      span_id: spanId,
      type,
      data,
    };
  }
}
