/**
 * HTTP Collector — Phase 2 구현.
 *
 * Express Router 기반 범용 UAEP 이벤트 수신 엔드포인트.
 * API key 인증, 세션 라이프사이클, 단일/배치 이벤트 수집을 제공한다.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';
import type { Collector } from '../base.js';

/** HTTP Collector 설정 */
export interface HTTPCollectorConfig {
  /** 허용할 API 키 목록 (비어있으면 open access) */
  apiKeys?: string[];
}

/**
 * HTTP Collector.
 *
 * Express Router를 통해 외부 에이전트가 HTTP POST로
 * UAEP 이벤트를 전송할 수 있는 수집기.
 *
 * - API key 인증 (x-api-key 헤더)
 * - 세션 생성/종료 엔드포인트
 * - 단일/배치 이벤트 수집 엔드포인트
 */
export class HTTPCollector implements Collector {
  readonly name = 'HTTPCollector';
  readonly sourceType = 'custom' as const;
  private handler: ((event: UAEPEvent) => void) | null = null;
  private apiKeys: Set<string>;

  constructor(config?: HTTPCollectorConfig) {
    this.apiKeys = new Set(config?.apiKeys ?? []);
  }

  onEvent(handler: (event: UAEPEvent) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    // HTTP Collector는 Express Router로 동작하므로 별도 시작 로직 불필요
  }

  async stop(): Promise<void> {
    // HTTP Collector는 Express Router로 동작하므로 별도 정리 로직 불필요
  }

  /** API 키 동적 추가 */
  addApiKey(key: string): void {
    this.apiKeys.add(key);
  }

  /** API 키 동적 제거 */
  removeApiKey(key: string): void {
    this.apiKeys.delete(key);
  }

  /**
   * Express Router를 반환한다.
   *
   * 라우트 경로:
   * - POST   /api/v1/collector/sessions        — 새 세션 등록
   * - DELETE  /api/v1/collector/sessions/:id    — 세션 종료
   * - POST   /api/v1/collector/events           — 단일 이벤트 수집
   * - POST   /api/v1/collector/events/batch     — 배치 이벤트 수집
   */
  getRouter(): Router {
    const router = Router();

    // API key 인증 미들웨어
    router.use((req: Request, res: Response, next: NextFunction) => {
      if (this.apiKeys.size === 0) {
        // 키가 설정되지 않은 경우 open access
        next();
        return;
      }
      const key = req.headers['x-api-key'] as string | undefined;
      if (!key || !this.apiKeys.has(key)) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }
      next();
    });

    // POST /api/v1/collector/sessions — 새 세션 등록
    router.post('/api/v1/collector/sessions', (req: Request, res: Response) => {
      const body = req.body as Record<string, unknown>;
      const agentId = (body.agent_id as string) ?? `http-${Date.now()}`;
      const agentName = (body.agent_name as string) ?? agentId;
      const sessionId = (body.session_id as string) ?? generateEventId();
      const source = (body.source as string) ?? 'custom';
      const teamId = body.team_id as string | undefined;
      const projectId = body.project_id as string | undefined;

      const event: UAEPEvent = {
        ts: new Date().toISOString(),
        event_id: generateEventId(),
        source: source as UAEPEvent['source'],
        agent_id: agentId,
        agent_name: agentName,
        session_id: sessionId,
        team_id: teamId,
        project_id: projectId,
        type: 'session.start',
        data: {
          parent_agent_id: body.parent_agent_id as string | undefined,
        },
      };

      if (this.handler) this.handler(event);
      res.status(201).json({ status: 'created', session_id: sessionId });
    });

    // DELETE /api/v1/collector/sessions/:id — 세션 종료
    router.delete('/api/v1/collector/sessions/:id', (req: Request, res: Response) => {
      const sessionId = req.params.id as string;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const agentId = (body.agent_id as string) ?? 'unknown';

      const event: UAEPEvent = {
        ts: new Date().toISOString(),
        event_id: generateEventId(),
        source: 'custom',
        agent_id: agentId,
        session_id: sessionId,
        type: 'session.end',
        data: {
          reason: (body.reason as string) ?? 'ended',
        },
      };

      if (this.handler) this.handler(event);
      res.status(200).json({ status: 'ended', session_id: sessionId });
    });

    // POST /api/v1/collector/events — 단일 이벤트 수집
    router.post('/api/v1/collector/events', (req: Request, res: Response) => {
      const event = req.body as UAEPEvent;
      if (!event || !event.event_id || !event.type) {
        res.status(400).json({ error: 'Invalid event' });
        return;
      }
      if (this.handler) this.handler(event);
      res.status(201).json({ status: 'accepted' });
    });

    // POST /api/v1/collector/events/batch — 배치 이벤트 수집
    router.post('/api/v1/collector/events/batch', (req: Request, res: Response) => {
      const events = req.body as UAEPEvent[];
      if (!Array.isArray(events)) {
        res.status(400).json({ error: 'Expected array of events' });
        return;
      }
      for (const event of events) {
        if (this.handler) this.handler(event);
      }
      res.status(201).json({ status: 'accepted', count: events.length });
    });

    return router;
  }
}
