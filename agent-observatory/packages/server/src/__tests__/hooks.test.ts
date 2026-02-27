/**
 * Claude Code Hooks 엔드포인트 테스트.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { InMemoryEventBus } from '../core/event-bus.js';
import { createHooksRouter } from '../delivery/hooks.js';
import type { UAEPEvent } from '@agent-observatory/shared';

function createApp() {
  const eventBus = new InMemoryEventBus();
  const receivedEvents: UAEPEvent[] = [];
  eventBus.subscribe((e) => receivedEvents.push(e));

  const app = express();
  app.use(express.json());
  app.use(createHooksRouter(eventBus));

  return { app, receivedEvents };
}

describe('Claude Code Hooks Endpoint', () => {
  let app: ReturnType<typeof express>;
  let receivedEvents: UAEPEvent[];

  beforeEach(() => {
    const ctx = createApp();
    app = ctx.app;
    receivedEvents = ctx.receivedEvents;
  });

  describe('POST /api/v1/hooks/claude-code - SessionStart', () => {
    it('should accept SessionStart with transcript_path and emit session.start', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-sonnet-4-6',
        source: 'claude_code',
        transcript_path: '/Users/joy/.claude/projects/-Users-joy-proj/abc12345.jsonl',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(res.body.session_id).toBe('abc12345');

      expect(receivedEvents).toHaveLength(1);
      const event = receivedEvents[0]!;
      expect(event.type).toBe('session.start');
      expect(event.model_id).toBe('claude-sonnet-4-6');
      expect(event.session_id).toBe('abc12345');
      expect(event.agent_id).toBe('cc-abc12345');
      expect(event.source).toBe('claude_code');
    });

    it('should accept SessionStart with explicit session_id', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-opus-4-6',
        session_id: 'explicit-session-001',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(receivedEvents).toHaveLength(1);
      const event = receivedEvents[0]!;
      expect(event.model_id).toBe('claude-opus-4-6');
      expect(event.session_id).toBe('explicit-session-001');
    });

    it('should return 400 if session_id cannot be determined', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-sonnet-4-6',
        // transcript_path와 session_id 모두 없음
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(400);

      expect(receivedEvents).toHaveLength(0);
    });

    it('should include model_id in event.data as well', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-haiku-4-5',
        session_id: 'haiku-session',
        agent_type: 'subagent',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      const event = receivedEvents[0]!;
      expect(event.data?.['model_id']).toBe('claude-haiku-4-5');
      expect(event.data?.['agent_type']).toBe('subagent');
      expect(event.data?.['from_hook']).toBe(true);
    });
  });

  describe('POST /api/v1/hooks/claude-code - SessionStop', () => {
    it('should accept SessionStop and emit session.end', async () => {
      const payload = {
        type: 'SessionStop',
        transcript_path: '/path/to/stopabc1.jsonl',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]!.type).toBe('session.end');
    });

    it('should accept Stop (alternative name) and emit session.end', async () => {
      const payload = {
        type: 'Stop',
        session_id: 'stop-session-99',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(receivedEvents[0]!.type).toBe('session.end');
    });

    it('should silently accept SessionStop without session_id', async () => {
      const payload = { type: 'SessionStop' };
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      // session_id 없으면 이벤트 발행 안 함
      expect(receivedEvents).toHaveLength(0);
    });
  });

  describe('POST /api/v1/hooks/claude-code - PostToolUse', () => {
    it('should silently accept PostToolUse', async () => {
      const payload = {
        type: 'PostToolUse',
        tool_name: 'Read',
        session_id: 'some-session',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(0);
    });
  });

  describe('POST /api/v1/hooks/claude-code - invalid payload', () => {
    it('should return 400 for missing type', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ model: 'test' })
        .expect(400);
    });

    it('should return 400 for empty body', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({})
        .expect(400);
    });

    it('should accept unknown hook types silently', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ type: 'FutureHookType', data: 'something' })
        .expect(200);
    });
  });
});
