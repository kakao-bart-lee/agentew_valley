import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { makeSessionStart, makeToolStart, makeMetricsUsage } from './helpers.js';

describe('Analytics API', () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createApp();
  });

  afterEach(() => {
    instance.close();
    instance.server.close();
    instance.io.close();
  });

  describe('GET /api/v1/analytics/cost', () => {
    it('should return zero values for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/cost');
      expect(res.status).toBe(200);
      expect(res.body.total_cost_usd).toBe(0);
      expect(res.body.total_tokens).toBe(0);
      expect(res.body.total_sessions).toBe(0);
      expect(res.body.cost_timeseries).toEqual([]);
      expect(res.body.time_range).toBeDefined();
    });

    it('should return aggregated cost data', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2'));
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost');
      expect(res.status).toBe(200);
      expect(res.body.total_tokens).toBe(300);
      expect(res.body.total_cost_usd).toBeCloseTo(0.30);
      expect(res.body.total_sessions).toBe(2);
    });

    it('should filter by time range', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', { ts: '2026-02-27T10:00:00Z' }));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2', { ts: '2026-02-27T12:00:00Z' }));
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const res = await request(instance.app).get(
        '/api/v1/analytics/cost?from=2026-02-27T11:00:00Z',
      );
      expect(res.body.total_sessions).toBe(1);
      expect(res.body.total_tokens).toBe(200);
    });
  });

  describe('GET /api/v1/analytics/cost/by-agent', () => {
    it('should return empty agents for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/cost/by-agent');
      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([]);
      expect(res.body.total_cost_usd).toBe(0);
    });

    it('should group costs by agent', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2'));
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost/by-agent');
      expect(res.body.agents).toHaveLength(2);

      const a1 = res.body.agents.find((a: { agent_id: string }) => a.agent_id === 'agent-1');
      expect(a1.total_tokens).toBe(100);
      expect(a1.cost_percentage).toBeCloseTo(100 / 3); // 0.10 / 0.30 * 100

      const a2 = res.body.agents.find((a: { agent_id: string }) => a.agent_id === 'agent-2');
      expect(a2.total_tokens).toBe(200);
    });

    it('should have cost_percentage summing to ~100%', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2'));
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));
      instance.eventBus.publish(makeSessionStart('agent-3', 'sess-3'));
      instance.eventBus.publish(makeMetricsUsage(300, 0.30, 'agent-3', { session_id: 'sess-3' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost/by-agent');
      const totalPercentage = res.body.agents.reduce(
        (sum: number, a: { cost_percentage: number }) => sum + a.cost_percentage,
        0,
      );
      expect(totalPercentage).toBeCloseTo(100);
    });
  });

  describe('GET /api/v1/analytics/cost/by-team', () => {
    it('should return empty teams for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/cost/by-team');
      expect(res.status).toBe(200);
      expect(res.body.teams).toEqual([]);
    });

    it('should group by team and exclude teamless agents', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', { team_id: 'team-alpha' }));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2', { team_id: 'team-alpha' }));
      instance.eventBus.publish(makeMetricsUsage(50, 0.05, 'agent-2', { session_id: 'sess-2' }));
      instance.eventBus.publish(makeSessionStart('agent-3', 'sess-3')); // no team
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-3', { session_id: 'sess-3' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost/by-team');
      expect(res.body.teams).toHaveLength(1);
      expect(res.body.teams[0].team_id).toBe('team-alpha');
      expect(res.body.teams[0].agent_count).toBe(2);
      expect(res.body.teams[0].session_count).toBe(2);
      expect(res.body.teams[0].total_tokens).toBe(150);
    });
  });

  describe('GET /api/v1/analytics/cost/by-project', () => {
    it('should return empty projects for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/cost/by-project');
      expect(res.status).toBe(200);
      expect(res.body.projects).toEqual([]);
    });

    it('should group costs by project', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', { project_id: 'moonlit' }));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2', { project_id: 'moonlit' }));
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));
      instance.eventBus.publish(makeSessionStart('agent-3', 'sess-3', { project_id: 'sunrise' }));
      instance.eventBus.publish(makeMetricsUsage(50, 0.05, 'agent-3', { session_id: 'sess-3' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost/by-project');
      expect(res.body.projects).toHaveLength(2);

      const moonlit = res.body.projects.find((project: { project_id: string }) => project.project_id === 'moonlit');
      expect(moonlit.total_tokens).toBe(300);
      expect(moonlit.agent_count).toBe(2);
      expect(moonlit.cost_percentage).toBeCloseTo((0.30 / 0.35) * 100);
    });
  });

  describe('GET /api/v1/analytics/cost/by-model', () => {
    it('should return empty models for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/cost/by-model');
      expect(res.status).toBe(200);
      expect(res.body.models).toEqual([]);
    });

    it('should group costs by model', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', { model_id: 'claude-sonnet-4-6' }));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2', { model_id: 'gpt-5-mini' }));
      instance.eventBus.publish(makeMetricsUsage(200, 0.20, 'agent-2', { session_id: 'sess-2' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost/by-model');
      expect(res.body.models).toHaveLength(2);
      expect(res.body.models[0].model_id).toBe('gpt-5-mini');
      expect(res.body.models[0].total_tokens).toBe(200);
      expect(res.body.models[1].model_id).toBe('claude-sonnet-4-6');
    });
  });

  describe('GET /api/v1/analytics/cost/by-tool', () => {
    it('should return empty tools for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/cost/by-tool');
      expect(res.status).toBe(200);
      expect(res.body.tools).toEqual([]);
      expect(res.body.total_cost_usd).toBe(0);
    });

    it('should compute proportional cost by tool category', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      // 3 Read (file_read), 1 Bash (command), 1 Write (file_write)
      instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeToolStart('Write', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeMetricsUsage(500, 1.00, 'agent-1', { session_id: 'sess-1' }));

      const res = await request(instance.app).get('/api/v1/analytics/cost/by-tool');
      expect(res.body.tools.length).toBeGreaterThan(0);

      const fileRead = res.body.tools.find((t: { tool_category: string }) => t.tool_category === 'file_read');
      expect(fileRead).toBeDefined();
      expect(fileRead.call_count).toBe(3);
      // 3/5 * 1.00 = 0.60
      expect(fileRead.estimated_cost_usd).toBeCloseTo(0.60);
      expect(fileRead.cost_percentage).toBeCloseTo(60);

      // Total cost_percentage should sum to ~100%
      const totalPercentage = res.body.tools.reduce(
        (sum: number, t: { cost_percentage: number }) => sum + t.cost_percentage,
        0,
      );
      expect(totalPercentage).toBeCloseTo(100);
    });
  });

  describe('GET /api/v1/analytics/tokens', () => {
    it('should return zero values for empty DB', async () => {
      const res = await request(instance.app).get('/api/v1/analytics/tokens');
      expect(res.status).toBe(200);
      expect(res.body.total_tokens).toBe(0);
      expect(res.body.tokens_timeseries).toEqual([]);
      expect(res.body.by_agent).toEqual([]);
    });

    it('should return token analytics with by_agent breakdown', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      instance.eventBus.publish(makeMetricsUsage(100, 0.10, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeSessionStart('agent-2', 'sess-2'));
      instance.eventBus.publish(makeMetricsUsage(300, 0.30, 'agent-2', { session_id: 'sess-2' }));

      const res = await request(instance.app).get('/api/v1/analytics/tokens');
      expect(res.body.total_tokens).toBe(400);
      expect(res.body.by_agent).toHaveLength(2);
      expect(res.body.by_agent[0].total_tokens).toBe(300); // agent-2 first (DESC)
      expect(res.body.by_agent[1].total_tokens).toBe(100);
    });
  });
});
