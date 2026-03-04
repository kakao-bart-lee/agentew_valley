import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { DEFAULT_FEATURE_FLAGS } from '../config/feature-flags.js';
import { makeSessionStart, makeToolStart, makeMetricsUsage, makeEvent } from './helpers.js';

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

  describe('GET /api/v1/agents/hierarchy', () => {
    it('should return empty hierarchy initially', async () => {
      const res = await request(instance.app).get('/api/v1/agents/hierarchy');
      expect(res.status).toBe(200);
      expect(res.body.hierarchy).toEqual([]);
    });

    it('should return hierarchy with parent-child', async () => {
      instance.eventBus.publish(makeSessionStart('parent-1', 'sess-p1'));
      instance.eventBus.publish(
        makeEvent({
          type: 'subagent.spawn',
          agent_id: 'parent-1',
          session_id: 'sess-p1',
          data: { child_agent_id: 'child-1' },
        }),
      );
      instance.eventBus.publish(makeSessionStart('child-1', 'sess-c1', { data: { parent_agent_id: 'parent-1' } }));

      const res = await request(instance.app).get('/api/v1/agents/hierarchy');
      expect(res.status).toBe(200);
      expect(res.body.hierarchy).toHaveLength(1);
      expect(res.body.hierarchy[0].agent.agent_id).toBe('parent-1');
      expect(res.body.hierarchy[0].children).toHaveLength(1);
      expect(res.body.hierarchy[0].children[0].agent.agent_id).toBe('child-1');
    });
  });

  describe('GET /api/v1/agents/by-team', () => {
    it('should return empty teams initially', async () => {
      const res = await request(instance.app).get('/api/v1/agents/by-team');
      expect(res.status).toBe(200);
      expect(res.body.teams).toEqual([]);
    });

    it('should group agents by team', async () => {
      instance.eventBus.publish(makeSessionStart('a1', 's1', { team_id: 'team-alpha' }));
      instance.eventBus.publish(makeSessionStart('a2', 's2', { team_id: 'team-alpha' }));
      instance.eventBus.publish(makeSessionStart('a3', 's3', { team_id: 'team-beta' }));

      const res = await request(instance.app).get('/api/v1/agents/by-team');
      expect(res.status).toBe(200);
      expect(res.body.teams).toHaveLength(2);

      const alpha = res.body.teams.find((t: { team_id: string }) => t.team_id === 'team-alpha');
      expect(alpha.agents).toHaveLength(2);

      const beta = res.body.teams.find((t: { team_id: string }) => t.team_id === 'team-beta');
      expect(beta.agents).toHaveLength(1);
    });
  });

  describe('GET /api/v1/events/search', () => {
    it('should return 400 without query', async () => {
      const res = await request(instance.app).get('/api/v1/events/search');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MISSING_QUERY');
    });

    it('should search events by type', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, { session_id: 'sess-1' }));

      const res = await request(instance.app).get('/api/v1/events/search?q=tool.start');
      expect(res.status).toBe(200);
      expect(res.body.query).toBe('tool.start');
      expect(res.body.events.length).toBeGreaterThanOrEqual(2);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });

    it('should search events by agent_id', async () => {
      instance.eventBus.publish(makeSessionStart('search-agent', 'sess-sa'));
      instance.eventBus.publish(makeSessionStart('other-agent', 'sess-oa'));

      const res = await request(instance.app).get('/api/v1/events/search?q=search-agent');
      expect(res.status).toBe(200);
      expect(res.body.events.length).toBeGreaterThanOrEqual(1);
      expect(res.body.events.every((e: { agent_id: string }) => e.agent_id === 'search-agent')).toBe(true);
    });

    it('should support pagination', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
      for (let i = 0; i < 5; i++) {
        instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
      }

      const res = await request(instance.app).get('/api/v1/events/search?q=tool.start&limit=2&offset=0');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe('GET /api/v1/migration/shadow-report', () => {
    it('should return stable disabled error when shadow mode is off', async () => {
      const res = await request(instance.app).get('/api/v1/migration/shadow-report');

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('Shadow mode is disabled');
      expect(res.body.code).toBe('SHADOW_MODE_DISABLED');
    });

    it('should reject non-read-only shadow mode even when enabled', async () => {
      const readWriteInstance = createApp({
        shadowModeEnabled: true,
        shadowModeReadOnly: false,
        shadowReportProvider: () => ({
          passCount: 1,
          failCount: 0,
          topDiffs: [],
        }),
      });

      try {
        const res = await request(readWriteInstance.app).get('/api/v1/migration/shadow-report');

        expect(res.status).toBe(503);
        expect(res.body.error).toBe('Shadow mode must run in read-only comparison mode');
        expect(res.body.code).toBe('SHADOW_MODE_READ_ONLY_REQUIRED');
      } finally {
        readWriteInstance.close();
        readWriteInstance.server.close();
        readWriteInstance.io.close();
      }
    });

    it('should return pass/fail summary and top diffs when shadow mode is on', async () => {
      const enabledInstance = createApp({
        shadowModeEnabled: true,
        shadowModeReadOnly: true,
        shadowReportProvider: () => ({
          passCount: 12,
          failCount: 3,
          topDiffs: [
            { entity: 'tasks', path: '$.status', count: 2 },
            { entity: 'reviews', path: '$.score', count: 1 },
          ],
        }),
      });

      try {
        const res = await request(enabledInstance.app).get('/api/v1/migration/shadow-report');

        expect(res.status).toBe(200);
        expect(res.body.pass_count).toBe(12);
        expect(res.body.fail_count).toBe(3);
        expect(res.body.top_diffs).toEqual([
          { entity: 'tasks', path: '$.status', count: 2 },
          { entity: 'reviews', path: '$.score', count: 1 },
        ]);
      } finally {
        enabledInstance.close();
        enabledInstance.server.close();
        enabledInstance.io.close();
      }
    });
  });

  describe('v2 domain feature guards', () => {
    it('should reject all v2 routes when global kill switch is enabled', async () => {
      const killSwitchInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          auth_v2: true,
          tasks_v2: true,
          webhooks_v2: true,
          kill_switch_all_v2: true,
        },
      });

      try {
        const authRes = await request(killSwitchInstance.app).get('/api/v2/auth/status');
        expect(authRes.status).toBe(503);
        expect(authRes.body.code).toBe('V2_KILL_SWITCH_ENABLED');
        expect(authRes.body.reason).toBe('kill_switch_all_v2');

        const tasksRes = await request(killSwitchInstance.app).get('/api/v2/tasks');
        expect(tasksRes.status).toBe(503);
        expect(tasksRes.body.code).toBe('V2_KILL_SWITCH_ENABLED');
        expect(tasksRes.body.reason).toBe('kill_switch_all_v2');

        const webhooksRes = await request(killSwitchInstance.app).post('/api/v2/webhooks/test').send({});
        expect(webhooksRes.status).toBe(503);
        expect(webhooksRes.body.code).toBe('V2_KILL_SWITCH_ENABLED');
        expect(webhooksRes.body.reason).toBe('kill_switch_all_v2');
      } finally {
        killSwitchInstance.close();
        killSwitchInstance.server.close();
        killSwitchInstance.io.close();
      }
    });

    it('should reject auth/tasks/webhooks v2 routes when flags are disabled', async () => {
      const authRes = await request(instance.app).get('/api/v2/auth/status');
      expect(authRes.status).toBe(503);
      expect(authRes.body.code).toBe('FEATURE_FLAG_DISABLED');
      expect(authRes.body.feature_flag).toBe('auth_v2');

      const tasksRes = await request(instance.app).get('/api/v2/tasks');
      expect(tasksRes.status).toBe(503);
      expect(tasksRes.body.code).toBe('FEATURE_FLAG_DISABLED');
      expect(tasksRes.body.feature_flag).toBe('tasks_v2');

      const webhooksRes = await request(instance.app).post('/api/v2/webhooks/test').send({});
      expect(webhooksRes.status).toBe(503);
      expect(webhooksRes.body.code).toBe('FEATURE_FLAG_DISABLED');
      expect(webhooksRes.body.feature_flag).toBe('webhooks_v2');
    });

    it('should allow only auth v2 routes when auth_v2 is enabled', async () => {
      const authEnabledInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          auth_v2: true,
        },
      });

      try {
        const authRes = await request(authEnabledInstance.app).get('/api/v2/auth/status');
        expect(authRes.status).toBe(200);
        expect(authRes.body.domain).toBe('auth');
        expect(authRes.body.version).toBe('v2');
        expect(authRes.body.status).toBe('enabled');

        const tasksRes = await request(authEnabledInstance.app).get('/api/v2/tasks');
        expect(tasksRes.status).toBe(503);
        expect(tasksRes.body.feature_flag).toBe('tasks_v2');

        const webhooksRes = await request(authEnabledInstance.app).post('/api/v2/webhooks/test').send({});
        expect(webhooksRes.status).toBe(503);
        expect(webhooksRes.body.feature_flag).toBe('webhooks_v2');
      } finally {
        authEnabledInstance.close();
        authEnabledInstance.server.close();
        authEnabledInstance.io.close();
      }
    });

    it('should allow v2 routes when domain flags are enabled and kill switch is disabled', async () => {
      const enabledInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          auth_v2: true,
          tasks_v2: true,
          webhooks_v2: true,
          kill_switch_all_v2: false,
        },
      });

      try {
        const authRes = await request(enabledInstance.app).get('/api/v2/auth/status');
        expect(authRes.status).toBe(200);
        expect(authRes.body.domain).toBe('auth');

        const tasksRes = await request(enabledInstance.app).get('/api/v2/tasks');
        expect(tasksRes.status).toBe(200);
        expect(tasksRes.body.domain).toBe('tasks');

        const webhooksRes = await request(enabledInstance.app).post('/api/v2/webhooks/test').send({});
        expect(webhooksRes.status).toBe(202);
        expect(webhooksRes.body.domain).toBe('webhooks');
      } finally {
        enabledInstance.close();
        enabledInstance.server.close();
        enabledInstance.io.close();
      }
    });

    it('should allow tasks and webhooks routes when their flags are enabled', async () => {
      const tasksAndWebhooksInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          tasks_v2: true,
          webhooks_v2: true,
        },
      });

      try {
        const tasksRes = await request(tasksAndWebhooksInstance.app).get('/api/v2/tasks');
        expect(tasksRes.status).toBe(200);
        expect(tasksRes.body.domain).toBe('tasks');
        expect(tasksRes.body.version).toBe('v2');
        expect(tasksRes.body.tasks).toEqual([]);
        expect(tasksRes.body.total).toBe(0);

        const webhooksRes = await request(tasksAndWebhooksInstance.app).post('/api/v2/webhooks/test').send({});
        expect(webhooksRes.status).toBe(202);
        expect(webhooksRes.body.domain).toBe('webhooks');
        expect(webhooksRes.body.version).toBe('v2');
        expect(webhooksRes.body.status).toBe('accepted');

        const authRes = await request(tasksAndWebhooksInstance.app).get('/api/v2/auth/status');
        expect(authRes.status).toBe(503);
        expect(authRes.body.feature_flag).toBe('auth_v2');
      } finally {
        tasksAndWebhooksInstance.close();
        tasksAndWebhooksInstance.server.close();
        tasksAndWebhooksInstance.io.close();
      }
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
