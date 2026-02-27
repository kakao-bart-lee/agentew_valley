import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { makeSessionStart, makeToolStart, makeMetricsUsage, makeEvent } from './helpers.js';

describe('REST API', () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createApp();
  });

  afterEach(() => {
    instance.server.close();
    instance.io.close();
  });

  describe('GET /api/v1/agents', () => {
    it('should return empty array initially', async () => {
      const res = await request(instance.app).get('/api/v1/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('should return agents after session.start', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1'));

      const res = await request(instance.app).get('/api/v1/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(1);
      expect(res.body.agents[0].agent_id).toBe('agent-1');
    });
  });

  describe('GET /api/v1/agents/:id', () => {
    it('should return 404 for unknown agent', async () => {
      const res = await request(instance.app).get('/api/v1/agents/unknown');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('should return agent detail', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1'));

      const res = await request(instance.app).get('/api/v1/agents/agent-1');
      expect(res.status).toBe(200);
      expect(res.body.agent.agent_id).toBe('agent-1');
      expect(res.body.agent.status).toBe('idle');
    });
  });

  describe('GET /api/v1/agents/:id/events', () => {
    it('should return events for agent', async () => {
      const evt = makeSessionStart('agent-1');
      instance.eventBus.publish(evt);

      const res = await request(instance.app).get('/api/v1/agents/agent-1/events');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.offset).toBe(0);
      expect(res.body.limit).toBe(50);
    });
  });

  describe('GET /api/v1/metrics/summary', () => {
    it('should return MetricsSnapshot structure', async () => {
      instance.eventBus.publish(makeToolStart('Read'));
      instance.eventBus.publish(makeMetricsUsage(100, 0.01));

      const res = await request(instance.app).get('/api/v1/metrics/summary');
      expect(res.status).toBe(200);
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.timestamp).toBeDefined();
      expect(res.body.metrics.timeseries).toBeDefined();
      expect(res.body.metrics.tool_distribution).toBeDefined();
    });
  });

  describe('GET /api/v1/metrics/timeseries', () => {
    it('should return timeseries data', async () => {
      instance.eventBus.publish(makeMetricsUsage(100, 0.01));

      const res = await request(instance.app).get(
        '/api/v1/metrics/timeseries?metric=tokens_per_minute&from=30',
      );
      expect(res.status).toBe(200);
      expect(res.body.metric).toBe('tokens_per_minute');
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('should return sessions list', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));

      const res = await request(instance.app).get('/api/v1/sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].session_id).toBe('sess-1');
    });
  });

  describe('GET /api/v1/config', () => {
    it('should return config', async () => {
      const res = await request(instance.app).get('/api/v1/config');
      expect(res.status).toBe(200);
      expect(res.body.config).toBeDefined();
      expect(res.body.config.watch_paths).toBeDefined();
    });
  });

  describe('PUT /api/v1/config', () => {
    it('should update config fields', async () => {
      const res = await request(instance.app)
        .put('/api/v1/config')
        .send({ watch_paths: ['/tmp/test'], metrics_interval_ms: 10000 });

      expect(res.status).toBe(200);
      expect(res.body.config.watch_paths).toEqual(['/tmp/test']);
      expect(res.body.config.metrics_interval_ms).toBe(10000);
    });

    it('should persist changes to subsequent GET', async () => {
      await request(instance.app)
        .put('/api/v1/config')
        .send({ timeseries_retention_minutes: 120 });

      const res = await request(instance.app).get('/api/v1/config');
      expect(res.body.config.timeseries_retention_minutes).toBe(120);
    });

    it('should ignore invalid fields', async () => {
      const before = await request(instance.app).get('/api/v1/config');
      const res = await request(instance.app)
        .put('/api/v1/config')
        .send({ metrics_interval_ms: -1, unknown_field: 'ignored' });

      expect(res.status).toBe(200);
      expect(res.body.config.metrics_interval_ms).toBe(before.body.config.metrics_interval_ms);
    });
  });

  describe('POST /api/v1/events', () => {
    it('should accept and publish a valid event', async () => {
      const event = makeEvent({ type: 'session.start' });

      const res = await request(instance.app)
        .post('/api/v1/events')
        .send(event);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('accepted');

      // verify event was processed
      const agent = instance.stateManager.getAgent(event.agent_id);
      expect(agent).toBeDefined();
    });

    it('should reject invalid event', async () => {
      const res = await request(instance.app)
        .post('/api/v1/events')
        .send({ invalid: true });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/events/batch', () => {
    it('should accept batch events', async () => {
      const events = [
        makeEvent({ type: 'session.start', agent_id: 'a1' }),
        makeEvent({ type: 'session.start', agent_id: 'a2' }),
      ];

      const res = await request(instance.app)
        .post('/api/v1/events/batch')
        .send(events);

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(2);
    });

    it('should reject non-array body', async () => {
      const res = await request(instance.app)
        .post('/api/v1/events/batch')
        .send({ not: 'array' });

      expect(res.status).toBe(400);
    });
  });
});
