import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { UAEPEvent } from '@agent-observatory/shared';
import { AgentSDKCollector } from '../agent-sdk/index.js';

/**
 * 테스트용 Express 앱을 생성하고 AgentSDKCollector의 Router를 마운트한다.
 */
function createTestApp(collector: AgentSDKCollector) {
  const app = express();
  app.use(express.json());
  app.use(collector.getRouter());
  return app;
}

describe('AgentSDKCollector', () => {
  let collector: AgentSDKCollector;
  let emittedEvents: UAEPEvent[];

  beforeEach(() => {
    collector = new AgentSDKCollector();
    emittedEvents = [];
    collector.onEvent((event) => {
      emittedEvents.push(event);
    });
  });

  describe('Collector interface', () => {
    it('should have correct name and sourceType', () => {
      expect(collector.name).toBe('AgentSDKCollector');
      expect(collector.sourceType).toBe('agent_sdk');
    });

    it('should start and stop without error', async () => {
      await expect(collector.start()).resolves.toBeUndefined();
      await expect(collector.stop()).resolves.toBeUndefined();
    });
  });

  describe('POST /api/v1/hooks/sdk', () => {
    it('should convert PreToolUse hook to tool.start UAEP event', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'PreToolUse',
        session_id: 'sess-12345678-abcd',
        agent_id: 'agent-001',
        timestamp: '2026-02-27T10:00:00.000Z',
        tool_name: 'Read',
        tool_use_id: 'toolu_read1',
        tool_input: { file_path: '/src/main.ts' },
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(emittedEvents).toHaveLength(1);

      const event = emittedEvents[0];
      expect(event.type).toBe('tool.start');
      expect(event.source).toBe('agent_sdk');
      expect(event.agent_id).toBe('agent-001');
      expect(event.session_id).toBe('sess-12345678-abcd');
      expect(event.span_id).toBe('toolu_read1');
      expect(event.ts).toBe('2026-02-27T10:00:00.000Z');
      expect(event.data?.tool_name).toBe('Read');
      expect(event.data?.tool_category).toBe('file_read');
      expect(event.data?.input_summary).toContain('/src/main.ts');
    });

    it('should convert PostToolUse hook to tool.end UAEP event', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'PostToolUse',
        session_id: 'sess-12345678-abcd',
        agent_id: 'agent-001',
        timestamp: '2026-02-27T10:00:01.000Z',
        tool_name: 'Read',
        tool_use_id: 'toolu_read1',
        duration_ms: 150,
        tool_output: 'file content here',
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(emittedEvents).toHaveLength(1);

      const event = emittedEvents[0];
      expect(event.type).toBe('tool.end');
      expect(event.source).toBe('agent_sdk');
      expect(event.agent_id).toBe('agent-001');
      expect(event.session_id).toBe('sess-12345678-abcd');
      expect(event.span_id).toBe('toolu_read1');
      expect(event.data?.tool_name).toBe('Read');
      expect(event.data?.duration_ms).toBe(150);
      expect(event.data?.output_summary).toBe('file content here');
    });

    it('should convert Notification hook to agent.status UAEP event', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'Notification',
        session_id: 'sess-12345678-abcd',
        agent_id: 'agent-001',
        timestamp: '2026-02-27T10:00:02.000Z',
        status: 'thinking',
        message: 'Analyzing code...',
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(emittedEvents).toHaveLength(1);

      const event = emittedEvents[0];
      expect(event.type).toBe('agent.status');
      expect(event.source).toBe('agent_sdk');
      expect(event.agent_id).toBe('agent-001');
      expect(event.data?.status).toBe('thinking');
      expect(event.data?.message).toBe('Analyzing code...');
    });

    it('should convert Stop hook to session.end UAEP event', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'Stop',
        session_id: 'sess-12345678-abcd',
        agent_id: 'agent-001',
        timestamp: '2026-02-27T10:05:00.000Z',
        reason: 'completed',
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(emittedEvents).toHaveLength(1);

      const event = emittedEvents[0];
      expect(event.type).toBe('session.end');
      expect(event.source).toBe('agent_sdk');
      expect(event.agent_id).toBe('agent-001');
      expect(event.session_id).toBe('sess-12345678-abcd');
      expect(event.data?.reason).toBe('completed');
    });

    it('should return 200 but emit no event for unknown hook', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'UnknownHook',
        session_id: 'sess-12345678-abcd',
        agent_id: 'agent-001',
        timestamp: '2026-02-27T10:00:00.000Z',
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(emittedEvents).toHaveLength(0);
    });

    it('should return 400 for invalid body (empty/non-object)', async () => {
      const app = createTestApp(collector);

      await request(app)
        .post('/api/v1/hooks/sdk')
        .send('not json')
        .set('Content-Type', 'text/plain')
        .expect(400);

      expect(emittedEvents).toHaveLength(0);
    });

    it('should use default values when optional fields are missing', async () => {
      const app = createTestApp(collector);

      // Minimal PreToolUse payload: only hook_name
      const payload = {
        hook_name: 'PreToolUse',
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      expect(emittedEvents).toHaveLength(1);

      const event = emittedEvents[0];
      expect(event.type).toBe('tool.start');
      expect(event.session_id).toBe('unknown-session');
      expect(event.agent_id).toBe('sdk-unknown-');
      expect(event.data?.tool_name).toBe('unknown');
      expect(event.data?.tool_category).toBe('other');
      // span_id should be generated when tool_use_id is missing
      expect(event.span_id).toBeDefined();
      expect(typeof event.span_id).toBe('string');
    });

    it('should truncate long tool input to 200 chars', async () => {
      const app = createTestApp(collector);

      const longInput = 'x'.repeat(500);
      const payload = {
        hook_name: 'PreToolUse',
        session_id: 'sess-1234',
        tool_name: 'Bash',
        tool_input: longInput,
      };

      await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(emittedEvents).toHaveLength(1);
      const summary = emittedEvents[0].data?.input_summary as string;
      expect(summary.length).toBeLessThanOrEqual(200);
    });

    it('should generate valid event_id for each event', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'Notification',
        session_id: 'sess-abc',
        timestamp: '2026-02-27T10:00:00.000Z',
        status: 'idle',
      };

      await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(emittedEvents).toHaveLength(1);
      const eventId = emittedEvents[0].event_id;
      // UUID v7 format: 8-4-4-4-12
      expect(eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('should not emit event when no handler is registered', async () => {
      const collectorNoHandler = new AgentSDKCollector();
      const app = createTestApp(collectorNoHandler);

      const payload = {
        hook_name: 'PreToolUse',
        session_id: 'sess-1234',
        tool_name: 'Read',
      };

      const res = await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(res.body).toEqual({ status: 'ok' });
      // No crash, request succeeds even without handler
    });

    it('should handle PostToolUse without duration_ms and tool_output', async () => {
      const app = createTestApp(collector);

      const payload = {
        hook_name: 'PostToolUse',
        session_id: 'sess-1234',
        tool_name: 'Edit',
      };

      await request(app)
        .post('/api/v1/hooks/sdk')
        .send(payload)
        .expect(200);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];
      expect(event.type).toBe('tool.end');
      expect(event.data?.duration_ms).toBeUndefined();
      expect(event.data?.output_summary).toBeUndefined();
    });
  });
});
