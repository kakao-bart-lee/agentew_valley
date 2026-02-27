import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';

describe('OpenAPI Documentation', () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createApp();
  });

  afterEach(() => {
    instance.close();
    instance.server.close();
    instance.io.close();
  });

  it('should serve OpenAPI spec at /api-docs/openapi.json', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Agent Observatory API');
  });

  it('should include all existing endpoints in paths', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    const paths = Object.keys(res.body.paths);

    // Core endpoints
    expect(paths).toContain('/api/v1/agents');
    expect(paths).toContain('/api/v1/agents/{id}');
    expect(paths).toContain('/api/v1/agents/{id}/events');
    expect(paths).toContain('/api/v1/agents/hierarchy');
    expect(paths).toContain('/api/v1/agents/by-team');
    expect(paths).toContain('/api/v1/sessions');
    expect(paths).toContain('/api/v1/sessions/{id}');
    expect(paths).toContain('/api/v1/metrics/summary');
    expect(paths).toContain('/api/v1/metrics/timeseries');
    expect(paths).toContain('/api/v1/events/search');
    expect(paths).toContain('/api/v1/config');
    expect(paths).toContain('/api/v1/events');
    expect(paths).toContain('/api/v1/events/batch');
  });

  it('should include Phase 3 endpoints in paths', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    const paths = Object.keys(res.body.paths);

    // Session Replay
    expect(paths).toContain('/api/v1/sessions/{id}/replay');

    // Analytics
    expect(paths).toContain('/api/v1/analytics/cost');
    expect(paths).toContain('/api/v1/analytics/cost/by-agent');
    expect(paths).toContain('/api/v1/analytics/cost/by-team');
    expect(paths).toContain('/api/v1/analytics/cost/by-tool');
    expect(paths).toContain('/api/v1/analytics/tokens');
  });

  it('should include component schemas', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    const schemaNames = Object.keys(res.body.components.schemas);

    expect(schemaNames).toContain('UAEPEvent');
    expect(schemaNames).toContain('AgentLiveState');
    expect(schemaNames).toContain('MetricsSnapshot');
    expect(schemaNames).toContain('SessionReplayResponse');
    expect(schemaNames).toContain('CostAnalyticsResponse');
    expect(schemaNames).toContain('CostByAgentResponse');
    expect(schemaNames).toContain('CostByTeamResponse');
    expect(schemaNames).toContain('CostByToolResponse');
    expect(schemaNames).toContain('TokenAnalyticsResponse');
  });

  it('should serve custom swagger-initializer.js', async () => {
    const res = await request(instance.app).get('/api-docs/swagger-initializer.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/api-docs/openapi.json');
  });

  it('should serve Swagger UI index.html', async () => {
    const res = await request(instance.app).get('/api-docs/index.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });
});
