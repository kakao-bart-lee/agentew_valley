import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { UAEPEvent } from '@agent-observatory/shared';
import { HTTPCollector } from '../http/index.js';

/**
 * 테스트 헬퍼: HTTPCollector를 마운트한 최소 Express 앱 생성.
 */
function createApp(collector: HTTPCollector) {
  const app = express();
  app.use(express.json());
  app.use(collector.getRouter());
  return app;
}

describe('HTTPCollector', () => {
  let collector: HTTPCollector;
  let handler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    collector = new HTTPCollector();
    handler = vi.fn();
    collector.onEvent(handler);
  });

  describe('POST /api/v1/collector/sessions', () => {
    it('should create a session.start event', async () => {
      const app = createApp(collector);

      const res = await request(app)
        .post('/api/v1/collector/sessions')
        .send({
          agent_id: 'agent-1',
          agent_name: 'My Agent',
          session_id: 'sess-1',
          source: 'custom',
          team_id: 'team-alpha',
          parent_agent_id: 'parent-0',
        })
        .expect(201);

      expect(res.body.status).toBe('created');
      expect(res.body.session_id).toBe('sess-1');

      expect(handler).toHaveBeenCalledTimes(1);
      const event: UAEPEvent = handler.mock.calls[0][0];
      expect(event.type).toBe('session.start');
      expect(event.agent_id).toBe('agent-1');
      expect(event.agent_name).toBe('My Agent');
      expect(event.session_id).toBe('sess-1');
      expect(event.source).toBe('custom');
      expect(event.team_id).toBe('team-alpha');
      expect(event.data?.parent_agent_id).toBe('parent-0');
      expect(event.event_id).toBeDefined();
      expect(event.ts).toBeDefined();
    });

    it('should generate defaults when optional fields are omitted', async () => {
      const app = createApp(collector);

      const res = await request(app)
        .post('/api/v1/collector/sessions')
        .send({})
        .expect(201);

      expect(res.body.status).toBe('created');
      expect(res.body.session_id).toBeDefined();

      const event: UAEPEvent = handler.mock.calls[0][0];
      expect(event.type).toBe('session.start');
      expect(event.agent_id).toMatch(/^http-\d+$/);
      expect(event.source).toBe('custom');
      expect(event.session_id).toBeDefined();
    });
  });

  describe('DELETE /api/v1/collector/sessions/:id', () => {
    it('should create a session.end event', async () => {
      const app = createApp(collector);

      const res = await request(app)
        .delete('/api/v1/collector/sessions/sess-1')
        .send({ agent_id: 'agent-1', reason: 'completed' })
        .expect(200);

      expect(res.body.status).toBe('ended');
      expect(res.body.session_id).toBe('sess-1');

      expect(handler).toHaveBeenCalledTimes(1);
      const event: UAEPEvent = handler.mock.calls[0][0];
      expect(event.type).toBe('session.end');
      expect(event.agent_id).toBe('agent-1');
      expect(event.session_id).toBe('sess-1');
      expect(event.data?.reason).toBe('completed');
    });

    it('should use defaults when body is empty', async () => {
      const app = createApp(collector);

      await request(app)
        .delete('/api/v1/collector/sessions/sess-2')
        .expect(200);

      const event: UAEPEvent = handler.mock.calls[0][0];
      expect(event.agent_id).toBe('unknown');
      expect(event.data?.reason).toBe('ended');
    });
  });

  describe('POST /api/v1/collector/events', () => {
    it('should forward a single valid UAEP event', async () => {
      const app = createApp(collector);

      const inputEvent = {
        ts: '2026-02-27T10:00:00.000Z',
        event_id: 'evt-001',
        source: 'custom',
        agent_id: 'agent-1',
        session_id: 'sess-1',
        type: 'tool.start',
        data: { tool_name: 'Read' },
      };

      const res = await request(app)
        .post('/api/v1/collector/events')
        .send(inputEvent)
        .expect(201);

      expect(res.body.status).toBe('accepted');
      expect(handler).toHaveBeenCalledTimes(1);

      const forwarded = handler.mock.calls[0][0] as UAEPEvent;
      expect(forwarded.event_id).toBe('evt-001');
      expect(forwarded.type).toBe('tool.start');
      expect(forwarded.agent_id).toBe('agent-1');
    });

    it('should return 400 for invalid event (missing event_id)', async () => {
      const app = createApp(collector);

      await request(app)
        .post('/api/v1/collector/events')
        .send({ type: 'tool.start' })
        .expect(400);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 400 for invalid event (missing type)', async () => {
      const app = createApp(collector);

      await request(app)
        .post('/api/v1/collector/events')
        .send({ event_id: 'evt-001' })
        .expect(400);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 400 for empty body', async () => {
      const app = createApp(collector);

      await request(app)
        .post('/api/v1/collector/events')
        .send({})
        .expect(400);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/collector/events/batch', () => {
    it('should forward multiple UAEP events', async () => {
      const app = createApp(collector);

      const events = [
        {
          ts: '2026-02-27T10:00:00.000Z',
          event_id: 'evt-001',
          source: 'custom',
          agent_id: 'agent-1',
          session_id: 'sess-1',
          type: 'tool.start',
        },
        {
          ts: '2026-02-27T10:00:01.000Z',
          event_id: 'evt-002',
          source: 'custom',
          agent_id: 'agent-1',
          session_id: 'sess-1',
          type: 'tool.end',
        },
      ];

      const res = await request(app)
        .post('/api/v1/collector/events/batch')
        .send(events)
        .expect(201);

      expect(res.body.status).toBe('accepted');
      expect(res.body.count).toBe(2);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when body is not an array', async () => {
      const app = createApp(collector);

      await request(app)
        .post('/api/v1/collector/events/batch')
        .send({ event_id: 'evt-001', type: 'tool.start' })
        .expect(400);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle empty array', async () => {
      const app = createApp(collector);

      const res = await request(app)
        .post('/api/v1/collector/events/batch')
        .send([])
        .expect(201);

      expect(res.body.count).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('API key authentication', () => {
    it('should return 401 without valid key when keys are configured', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['secret-key-1'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      await request(app)
        .post('/api/v1/collector/sessions')
        .send({ agent_id: 'agent-1' })
        .expect(401);

      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 401 with wrong key', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['secret-key-1'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      const res = await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'wrong-key')
        .send({ agent_id: 'agent-1' })
        .expect(401);

      expect(res.body.error).toBe('Invalid API key');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should succeed with valid x-api-key header', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['secret-key-1'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'secret-key-1')
        .send({ agent_id: 'agent-1' })
        .expect(201);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should allow open access when no API keys are configured', async () => {
      // collector has no apiKeys by default
      const app = createApp(collector);

      await request(app)
        .post('/api/v1/collector/sessions')
        .send({ agent_id: 'agent-1' })
        .expect(201);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should apply auth to all routes', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['key-1'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      // All routes should reject without key
      await request(app)
        .post('/api/v1/collector/sessions')
        .send({})
        .expect(401);

      await request(app)
        .delete('/api/v1/collector/sessions/sess-1')
        .expect(401);

      await request(app)
        .post('/api/v1/collector/events')
        .send({ event_id: 'e1', type: 'tool.start' })
        .expect(401);

      await request(app)
        .post('/api/v1/collector/events/batch')
        .send([])
        .expect(401);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('dynamic API key management', () => {
    it('should support adding API keys at runtime', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['key-1'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      // key-2 should not work yet
      await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'key-2')
        .send({})
        .expect(401);

      // add key-2
      secureCollector.addApiKey('key-2');

      await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'key-2')
        .send({})
        .expect(201);
    });

    it('should support removing API keys at runtime', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['key-1', 'key-2'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      // key-1 works initially
      await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'key-1')
        .send({})
        .expect(201);

      // remove key-1 (key-2 still exists, so auth is still enforced)
      secureCollector.removeApiKey('key-1');

      await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'key-1')
        .send({})
        .expect(401);

      // key-2 still works
      await request(app)
        .post('/api/v1/collector/sessions')
        .set('x-api-key', 'key-2')
        .send({})
        .expect(201);
    });

    it('should revert to open access when all keys are removed', async () => {
      const secureCollector = new HTTPCollector({ apiKeys: ['key-1'] });
      secureCollector.onEvent(handler);
      const app = createApp(secureCollector);

      // requires auth initially
      await request(app)
        .post('/api/v1/collector/sessions')
        .send({})
        .expect(401);

      // remove the only key -> reverts to open access
      secureCollector.removeApiKey('key-1');

      await request(app)
        .post('/api/v1/collector/sessions')
        .send({})
        .expect(201);
    });
  });

  describe('event handler not registered', () => {
    it('should not throw when handler is not set', async () => {
      const noHandlerCollector = new HTTPCollector();
      // intentionally NOT calling onEvent
      const app = createApp(noHandlerCollector);

      await request(app)
        .post('/api/v1/collector/sessions')
        .send({ agent_id: 'agent-1' })
        .expect(201);

      await request(app)
        .post('/api/v1/collector/events')
        .send({ event_id: 'e1', type: 'tool.start' })
        .expect(201);

      await request(app)
        .post('/api/v1/collector/events/batch')
        .send([{ event_id: 'e1', type: 'tool.start' }])
        .expect(201);
    });
  });
});
