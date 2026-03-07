import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { makeEvent, makeMetricsUsage, makeSessionStart, makeToolStart } from './helpers.js';

describe('REST API', () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createApp();
  });

  afterEach(() => {
    instance.close();
    instance.server.close();
    instance.io.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns ok', async () => {
      const res = await request(instance.app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  describe('GET /api/v1/agents', () => {
    it('returns empty array initially', async () => {
      const res = await request(instance.app).get('/api/v1/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns agents after session.start', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1'));

      const res = await request(instance.app).get('/api/v1/agents');
      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(1);
      expect(res.body.agents[0].agent_id).toBe('agent-1');
    });
  });

  describe('GET /api/v1/agents/:id', () => {
    it('returns 404 for unknown agent', async () => {
      const res = await request(instance.app).get('/api/v1/agents/unknown');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('AGENT_NOT_FOUND');
    });

    it('returns agent detail', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1'));

      const res = await request(instance.app).get('/api/v1/agents/agent-1');
      expect(res.status).toBe(200);
      expect(res.body.agent.agent_id).toBe('agent-1');
      expect(res.body.agent.status).toBe('idle');
    });
  });

  describe('GET /api/v1/agents/:id/events', () => {
    it('returns events for agent', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1'));

      const res = await request(instance.app).get('/api/v1/agents/agent-1/events');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.offset).toBe(0);
      expect(res.body.limit).toBe(50);
    });
  });

  describe('GET /api/v1/agents/by-team', () => {
    it('returns empty teams initially', async () => {
      const res = await request(instance.app).get('/api/v1/agents/by-team');
      expect(res.status).toBe(200);
      expect(res.body.teams).toEqual([]);
    });

    it('groups agents by team', async () => {
      instance.eventBus.publish(makeSessionStart('a1', 's1', { team_id: 'team-alpha' }));
      instance.eventBus.publish(makeSessionStart('a2', 's2', { team_id: 'team-alpha' }));
      instance.eventBus.publish(makeSessionStart('a3', 's3', { team_id: 'team-beta' }));

      const res = await request(instance.app).get('/api/v1/agents/by-team');
      expect(res.status).toBe(200);
      expect(res.body.teams).toHaveLength(2);
      expect(res.body.teams.find((team: { team_id: string }) => team.team_id === 'team-alpha').agents).toHaveLength(2);
      expect(res.body.teams.find((team: { team_id: string }) => team.team_id === 'team-beta').agents).toHaveLength(1);
    });
  });

  describe('GET /api/v1/sessions', () => {
    it('returns sessions list with runtime taxonomy and task context', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
        source: 'omx',
        runtime: {
          family: 'codex',
          orchestrator: 'omx',
          client: 'omx',
        },
        project_id: 'moonlit',
        task_id: 'task-42',
        goal_id: 'goal-7',
        task_context: {
          provider: 'paperclip',
          issue_identifier: 'ISSUE-42',
        },
      }));

      const res = await request(instance.app).get('/api/v1/sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].runtime).toEqual({
        family: 'codex',
        orchestrator: 'omx',
        client: 'omx',
      });
      expect(res.body.sessions[0].project_id).toBe('moonlit');
      expect(res.body.sessions[0].task_context.issue_identifier).toBe('ISSUE-42');
    });
  });

  describe('GET context overlay endpoints', () => {
    it('returns session task context', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-ctx', {
        project_id: 'moonlit',
        task_id: 'task-42',
        goal_id: 'goal-7',
        task_context: {
          provider: 'paperclip',
          issue_identifier: 'ISSUE-42',
        },
      }));

      const res = await request(instance.app).get('/api/v1/sessions/sess-ctx/context');
      expect(res.status).toBe(200);
      expect(res.body.task_context.project_id).toBe('moonlit');
      expect(res.body.task_context.task_id).toBe('task-42');
      expect(res.body.task_context.issue_identifier).toBe('ISSUE-42');
    });

    it('returns agent task context from latest session', async () => {
      instance.eventBus.publish(makeSessionStart('agent-ctx', 'sess-a', {
        task_context: { provider: 'paperclip', issue_identifier: 'ISSUE-A' },
      }));

      const res = await request(instance.app).get('/api/v1/agents/agent-ctx/context');
      expect(res.status).toBe(200);
      expect(res.body.task_context.agent_id).toBe('agent-ctx');
      expect(res.body.task_context.issue_identifier).toBe('ISSUE-A');
    });
  });

  describe('GET /api/v1/metrics/summary', () => {
    it('returns MetricsSnapshot structure', async () => {
      instance.eventBus.publish(makeToolStart('Read'));
      instance.eventBus.publish(makeMetricsUsage(100, 0.01));

      const res = await request(instance.app).get('/api/v1/metrics/summary');
      expect(res.status).toBe(200);
      expect(res.body.metrics.timestamp).toBeDefined();
      expect(res.body.metrics.timeseries).toBeDefined();
      expect(res.body.metrics.tool_distribution).toBeDefined();
    });
  });

  describe('GET /api/v1/metrics/timeseries', () => {
    it('returns timeseries data', async () => {
      instance.eventBus.publish(makeMetricsUsage(100, 0.01));

      const res = await request(instance.app).get('/api/v1/metrics/timeseries?metric=tokens_per_minute&from=30');
      expect(res.status).toBe(200);
      expect(res.body.metric).toBe('tokens_per_minute');
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/events/search', () => {
    it('returns 400 without query', async () => {
      const res = await request(instance.app).get('/api/v1/events/search');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_QUERY');
    });

    it('searches events by type', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, { session_id: 'sess-1' }));

      const res = await request(instance.app).get('/api/v1/events/search?q=tool.start');
      expect(res.status).toBe(200);
      expect(res.body.query).toBe('tool.start');
      expect(res.body.events.length).toBeGreaterThanOrEqual(2);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('supports pagination', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      for (let i = 0; i < 5; i += 1) {
        instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      }

      const res = await request(instance.app).get('/api/v1/events/search?q=tool.start&limit=2&offset=0');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe('GET /api/v1/dashboard/summary', () => {
    it('exposes observe-first cost breakdown and budget alerts only', async () => {
      instance.historyStore.setAgentBudget('agent-1', 100, 'Moonlit');
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
        ts: '2026-03-01T10:00:00Z',
        project_id: 'moonlit',
        model_id: 'claude-sonnet-4-6',
      }));
      instance.eventBus.publish(makeMetricsUsage(100, 0.9, 'agent-1', { session_id: 'sess-1' }));

      const res = await request(instance.app).get('/api/v1/dashboard/summary?from=2026-03-01T00:00:00Z&to=2026-04-01T00:00:00Z');

      expect(res.status).toBe(200);
      expect(res.body.cost_summary.total_cost_usd).toBeCloseTo(0.9);
      expect(res.body.top_projects[0].project_id).toBe('moonlit');
      expect(res.body.top_models[0].model_id).toBe('claude-sonnet-4-6');
      expect(res.body.budget_alerts).toHaveLength(1);
      expect(res.body.pending_alerts).toBe(1);
      expect(res.body.alert_severity).toBe('warning');
      expect(res.body).not.toHaveProperty('stale_tasks');
      expect(res.body).not.toHaveProperty('goal_progress');
      expect(res.body).not.toHaveProperty('pending_approvals');
      expect(res.body).not.toHaveProperty('mc_db_connected');
    });
  });

  describe('GET /api/v1/config', () => {
    it('returns config', async () => {
      const res = await request(instance.app).get('/api/v1/config');
      expect(res.status).toBe(200);
      expect(res.body.config.watch_paths).toBeDefined();
      expect(res.body).not.toHaveProperty('feature_flags');
    });
  });

  describe('PUT /api/v1/config', () => {
    it('updates config fields', async () => {
      const res = await request(instance.app)
        .put('/api/v1/config')
        .send({ watch_paths: ['/tmp/test'], metrics_interval_ms: 10000 });

      expect(res.status).toBe(200);
      expect(res.body.config.watch_paths).toEqual(['/tmp/test']);
      expect(res.body.config.metrics_interval_ms).toBe(10000);
    });

    it('persists changes to subsequent GET', async () => {
      await request(instance.app)
        .put('/api/v1/config')
        .send({ timeseries_retention_minutes: 120 });

      const res = await request(instance.app).get('/api/v1/config');
      expect(res.body.config.timeseries_retention_minutes).toBe(120);
    });

    it('ignores invalid fields', async () => {
      const before = await request(instance.app).get('/api/v1/config');
      const res = await request(instance.app)
        .put('/api/v1/config')
        .send({ metrics_interval_ms: -1, unknown_field: 'ignored' });

      expect(res.status).toBe(200);
      expect(res.body.config.metrics_interval_ms).toBe(before.body.config.metrics_interval_ms);
    });
  });

  describe('POST /api/v1/events', () => {
    it('accepts and publishes a valid event', async () => {
      const event = makeEvent({ type: 'session.start' });

      const res = await request(instance.app)
        .post('/api/v1/events')
        .send(event);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('accepted');
      expect(instance.stateManager.getAgent(event.agent_id)).toBeDefined();
    });

    it('rejects invalid event', async () => {
      const res = await request(instance.app)
        .post('/api/v1/events')
        .send({ invalid: true });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/events/batch', () => {
    it('accepts batch events', async () => {
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

    it('rejects non-array body', async () => {
      const res = await request(instance.app)
        .post('/api/v1/events/batch')
        .send({ not: 'array' });

      expect(res.status).toBe(400);
    });
  });

  describe('legacy observe-extraneous routes', () => {
    it('returns 404 for removed migration and v2 routes', async () => {
      const removedRoutes = [
        '/api/v1/migration/shadow-report',
        '/api/v2/auth/status',
        '/api/v2/tasks',
        '/api/v2/goals',
        '/api/v2/approvals',
        '/api/v2/activities',
        '/api/v2/adapters',
      ];

      for (const route of removedRoutes) {
        const res = await request(instance.app).get(route);
        expect(res.status, route).toBe(404);
      }

      const webhookRes = await request(instance.app).post('/api/v2/webhooks/test').send({});
      expect(webhookRes.status).toBe(404);
    });
  });
});
