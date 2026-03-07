import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('serves OpenAPI spec at /api-docs/openapi.json', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toBe('Agent Observatory API');
  });

  it('includes observe-only endpoints in paths', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    const paths = Object.keys(res.body.paths);

    expect(paths).toContain('/api/v1/health');
    expect(paths).toContain('/api/v1/agents');
    expect(paths).toContain('/api/v1/agents/{id}');
    expect(paths).toContain('/api/v1/agents/{id}/events');
    expect(paths).toContain('/api/v1/agents/{id}/context');
    expect(paths).toContain('/api/v1/agents/by-team');
    expect(paths).toContain('/api/v1/sessions');
    expect(paths).toContain('/api/v1/sessions/{id}');
    expect(paths).toContain('/api/v1/sessions/{id}/context');
    expect(paths).toContain('/api/v1/sessions/{id}/replay');
    expect(paths).toContain('/api/v1/metrics/summary');
    expect(paths).toContain('/api/v1/metrics/timeseries');
    expect(paths).toContain('/api/v1/dashboard/summary');
    expect(paths).toContain('/api/v1/events/search');
    expect(paths).toContain('/api/v1/config');
    expect(paths).toContain('/api/v1/events');
    expect(paths).toContain('/api/v1/events/batch');
    expect(paths).toContain('/api/v1/analytics/cost');
    expect(paths).toContain('/api/v1/analytics/cost/by-agent');
    expect(paths).toContain('/api/v1/analytics/cost/by-project');
    expect(paths).toContain('/api/v1/analytics/cost/by-team');
    expect(paths).toContain('/api/v1/analytics/cost/by-model');
    expect(paths).toContain('/api/v1/analytics/cost/by-tool');
    expect(paths).toContain('/api/v1/analytics/tokens');

    expect(paths).not.toContain('/api/v1/migration/shadow-report');
    expect(paths).not.toContain('/api/v2/auth/status');
    expect(paths).not.toContain('/api/v2/tasks');
    expect(paths).not.toContain('/api/v2/approvals');
    expect(paths).not.toContain('/api/v2/activities');
    expect(paths).not.toContain('/api/v2/adapters');
    expect(paths).not.toContain('/api/v2/webhooks/test');
  });

  it('includes component schemas for observe-only surfaces', async () => {
    const res = await request(instance.app).get('/api-docs/openapi.json');
    const schemaNames = Object.keys(res.body.components.schemas);

    expect(schemaNames).toContain('UAEPEvent');
    expect(schemaNames).toContain('AgentLiveState');
    expect(schemaNames).toContain('RuntimeDescriptor');
    expect(schemaNames).toContain('TaskContextSnapshot');
    expect(schemaNames).toContain('TaskContextResponse');
    expect(schemaNames).toContain('MetricsSnapshot');
    expect(schemaNames).toContain('SessionReplayResponse');
    expect(schemaNames).toContain('CostAnalyticsResponse');
    expect(schemaNames).toContain('CostByAgentResponse');
    expect(schemaNames).toContain('CostByTeamResponse');
    expect(schemaNames).toContain('CostByToolResponse');
    expect(schemaNames).toContain('TokenAnalyticsResponse');
    expect(schemaNames).toContain('DashboardSummaryResponse');
    expect(schemaNames).not.toContain('ShadowReportResponse');
  });

  it('serves custom swagger-initializer.js', async () => {
    const res = await request(instance.app).get('/api-docs/swagger-initializer.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/api-docs/openapi.json');
  });

  it('serves Swagger UI index.html', async () => {
    const res = await request(instance.app).get('/api-docs/index.html');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });
});
