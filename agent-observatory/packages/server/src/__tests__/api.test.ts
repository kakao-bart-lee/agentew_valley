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
    it('should return sessions list with work context', async () => {
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
        project_id: 'moonlit',
        task_id: 'task-42',
        goal_id: 'goal-7',
      }));

      const res = await request(instance.app).get('/api/v1/sessions');
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(res.body.sessions[0].session_id).toBe('sess-1');
      expect(res.body.sessions[0].project_id).toBe('moonlit');
      expect(res.body.sessions[0].task_id).toBe('task-42');
      expect(res.body.sessions[0].goal_id).toBe('goal-7');
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

  describe('dashboard summary and task checkout', () => {
    it('should expose pending alerts, top cost breakdowns, and stale tasks', async () => {
      instance.historyStore.setAgentBudget('agent-1', 100, 'Moonlit');
      instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
        ts: '2026-03-01T10:00:00Z',
        project_id: 'moonlit',
        model_id: 'claude-sonnet-4-6',
      }));
      instance.eventBus.publish(makeMetricsUsage(100, 0.90, 'agent-1', { session_id: 'sess-1' }));
      instance.eventBus.publish(makeEvent({
        type: 'task.sync',
        source: 'mission_control',
        agent_id: 'observatory',
        session_id: 'mission_control_sync',
        data: {
          id: 'task-1',
          title: 'Investigate stale worker',
          project: 'moonlit',
          status: 'in_progress',
          priority: 'high',
          assigned_to: 'agent-1',
          created_at: Math.floor(new Date('2026-03-01T09:00:00Z').getTime() / 1000),
          started_at: Math.floor(new Date('2026-03-01T09:00:00Z').getTime() / 1000),
          updated_at: Math.floor(new Date('2026-03-01T09:10:00Z').getTime() / 1000),
        },
      }));

      const res = await request(instance.app).get(
        '/api/v1/dashboard/summary?from=2026-03-01T00:00:00Z&to=2026-04-01T00:00:00Z',
      );

      expect(res.status).toBe(200);
      expect(res.body.cost_summary.total_cost_usd).toBeCloseTo(0.90);
      expect(res.body.top_projects[0].project_id).toBe('moonlit');
      expect(res.body.top_models[0].model_id).toBe('claude-sonnet-4-6');
      expect(res.body.budget_alerts).toHaveLength(1);
      expect(res.body.stale_tasks).toHaveLength(1);
      expect(res.body.pending_alerts).toBe(2);
      expect(res.body.alert_severity).toBe('warning');
    });

    it('should return tasks with project and stale fields when tasks v2 is enabled', async () => {
      const tasksInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          tasks_v2: true,
        },
      });

      try {
        tasksInstance.eventBus.publish(makeEvent({
          type: 'task.sync',
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          data: {
            id: 'task-1',
            title: 'Refactor dashboard summary',
            project: 'moonlit',
            status: 'in_progress',
            priority: 'high',
            assigned_to: 'agent-1',
            created_at: Math.floor(Date.now() / 1000) - 7200,
            started_at: Math.floor(Date.now() / 1000) - 7200,
            updated_at: Math.floor(Date.now() / 1000) - 3600,
          },
        }));

        const res = await request(tasksInstance.app).get('/api/v2/tasks?project=moonlit');
        expect(res.status).toBe(200);
        expect(res.body.tasks).toHaveLength(1);
        expect(res.body.tasks[0].project).toBe('moonlit');
        expect(res.body.tasks[0].is_stale).toBe(true);
      } finally {
        tasksInstance.close();
        tasksInstance.server.close();
        tasksInstance.io.close();
      }
    });

    it('should enforce atomic checkout and return 409 on conflict', async () => {
      const tasksInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          tasks_v2: true,
        },
      });

      try {
        tasksInstance.eventBus.publish(makeEvent({
          type: 'task.sync',
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          data: {
            id: 'task-1',
            title: 'Atomic checkout',
            status: 'assigned',
            priority: 'medium',
            updated_at: Math.floor(Date.now() / 1000),
          },
        }));

        const first = await request(tasksInstance.app)
          .post('/api/v2/tasks/task-1/checkout')
          .send({ agent_id: 'agent-1' });
        expect(first.status).toBe(200);
        expect(first.body.task.checkout_agent_id).toBe('agent-1');

        const conflict = await request(tasksInstance.app)
          .post('/api/v2/tasks/task-1/checkout')
          .send({ agent_id: 'agent-2' });
        expect(conflict.status).toBe(409);
        expect(conflict.body.code).toBe('TASK_CHECKOUT_CONFLICT');
        expect(conflict.body.task.checkout_agent_id).toBe('agent-1');
      } finally {
        tasksInstance.close();
        tasksInstance.server.close();
        tasksInstance.io.close();
      }
    });

    it('should expose goal progress and support comments plus checkout release', async () => {
      const tasksInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          tasks_v2: true,
        },
      });

      try {
        tasksInstance.eventBus.publish(makeEvent({
          type: 'goal.snapshot',
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          data: {
            goals: [
              { id: 'G-100', title: 'Phase 2', level: 1, status: 'active', source_path: '/tmp/GOALS.md' },
              { id: 'G-110', title: 'Goal Hierarchy', level: 2, parent_id: 'G-100', status: 'active', source_path: '/tmp/GOALS.md' },
            ],
            source_paths: ['/tmp/GOALS.md'],
          },
        }));
        tasksInstance.eventBus.publish(makeEvent({
          type: 'task.snapshot',
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          data: {
            source_paths: ['/tmp/TASK.md'],
            tasks: [
              {
                id: 'T-100',
                title: 'Build hierarchy',
                status: 'in_progress',
                priority: 'high',
                goal_id: 'G-110',
                project: 'moonlit',
                dependencies: [],
                source_path: '/tmp/TASK.md',
                updated_at: Math.floor(Date.now() / 1000),
              },
            ],
          },
        }));

        const goalsRes = await request(tasksInstance.app).get('/api/v2/goals');
        expect(goalsRes.status).toBe(200);
        expect(goalsRes.body.goals).toHaveLength(1);
        expect(goalsRes.body.goals[0].children[0].id).toBe('G-110');
        expect(goalsRes.body.goals[0].total_tasks).toBe(1);

        const checkoutRes = await request(tasksInstance.app)
          .post('/api/v2/tasks/T-100/checkout')
          .send({ agent_id: 'agent-1' });
        expect(checkoutRes.status).toBe(200);
        expect(checkoutRes.body.task.checkout_agent_id).toBe('agent-1');

        const commentRes = await request(tasksInstance.app)
          .post('/api/v2/tasks/T-100/comments')
          .send({ author_agent_id: 'agent-1', body: 'Blocked on review copy.' });
        expect(commentRes.status).toBe(201);

        const commentsRes = await request(tasksInstance.app).get('/api/v2/tasks/T-100/comments');
        expect(commentsRes.status).toBe(200);
        expect(commentsRes.body.comments).toHaveLength(1);
        expect(commentsRes.body.comments[0].author_agent_id).toBe('agent-1');

        const releaseRes = await request(tasksInstance.app).delete('/api/v2/tasks/T-100/checkout');
        expect(releaseRes.status).toBe(200);
        expect(releaseRes.body.task.checkout_agent_id).toBeUndefined();
      } finally {
        tasksInstance.close();
        tasksInstance.server.close();
        tasksInstance.io.close();
      }
    });

    it('should respect OBSERVATORY_STALE_THRESHOLD_HOURS when computing stale tasks', async () => {
      const previous = process.env.OBSERVATORY_STALE_THRESHOLD_HOURS;
      process.env.OBSERVATORY_STALE_THRESHOLD_HOURS = '3';

      const tasksInstance = createApp({
        featureFlags: {
          ...DEFAULT_FEATURE_FLAGS,
          tasks_v2: true,
        },
      });

      try {
        tasksInstance.eventBus.publish(makeEvent({
          type: 'task.sync',
          source: 'mission_control',
          agent_id: 'observatory',
          session_id: 'mission_control_sync',
          data: {
            id: 'task-threshold',
            title: 'Threshold test',
            status: 'in_progress',
            priority: 'medium',
            created_at: Math.floor(Date.now() / 1000) - 7200,
            started_at: Math.floor(Date.now() / 1000) - 7200,
            updated_at: Math.floor(Date.now() / 1000) - 7200,
          },
        }));

        const res = await request(tasksInstance.app).get('/api/v2/tasks');
        expect(res.status).toBe(200);
        expect(res.body.tasks[0].is_stale).toBe(false);
      } finally {
        if (previous === undefined) {
          delete process.env.OBSERVATORY_STALE_THRESHOLD_HOURS;
        } else {
          process.env.OBSERVATORY_STALE_THRESHOLD_HOURS = previous;
        }
        tasksInstance.close();
        tasksInstance.server.close();
        tasksInstance.io.close();
      }
    });
  });

  describe('governance v2 routes', () => {
    it('should create, retrieve, update, and count approvals', async () => {
        const governanceInstance = createApp({
          featureFlags: {
            ...DEFAULT_FEATURE_FLAGS,
            tasks_v2: true,
          },
        });

        try {
          const createRes = await request(governanceInstance.app)
            .post('/api/v2/approvals')
            .send({
              type: 'dangerous_action',
              requested_by: 'agent-1',
              payload: { command: 'rm -rf /tmp/example', reason: 'cleanup' },
            });

          expect(createRes.status).toBe(201);
          expect(createRes.body.approval.status).toBe('pending');
          expect(createRes.body.approval.payload.command).toBe('rm -rf /tmp/example');

          const approvalId = createRes.body.approval.id as string;

          const summaryPending = await request(governanceInstance.app).get('/api/v1/dashboard/summary');
          expect(summaryPending.status).toBe(200);
          expect(summaryPending.body.pending_approvals).toBe(1);

          const listPending = await request(governanceInstance.app).get('/api/v2/approvals?status=pending');
          expect(listPending.status).toBe(200);
          expect(listPending.body.total).toBe(1);
          expect(listPending.body.pending).toBe(1);

          const detailRes = await request(governanceInstance.app).get(`/api/v2/approvals/${approvalId}`);
          expect(detailRes.status).toBe(200);
          expect(detailRes.body.approval.id).toBe(approvalId);
          expect(detailRes.body.approval.payload.reason).toBe('cleanup');

          const updateRes = await request(governanceInstance.app)
            .patch(`/api/v2/approvals/${approvalId}`)
            .send({
              status: 'approved',
              decision_note: 'Reviewed and approved.',
              decided_by: 'user',
            });

          expect(updateRes.status).toBe(200);
          expect(updateRes.body.approval.status).toBe('approved');
          expect(updateRes.body.approval.decision_note).toBe('Reviewed and approved.');
          expect(updateRes.body.approval.decided_by).toBe('user');

          const summaryDone = await request(governanceInstance.app).get('/api/v1/dashboard/summary');
          expect(summaryDone.status).toBe(200);
          expect(summaryDone.body.pending_approvals).toBe(0);
        } finally {
          governanceInstance.close();
          governanceInstance.server.close();
          governanceInstance.io.close();
        }
    });

    it('should filter activities by entity and actor metadata', async () => {
        const governanceInstance = createApp({
          featureFlags: {
            ...DEFAULT_FEATURE_FLAGS,
            tasks_v2: true,
          },
        });

        try {
          governanceInstance.eventBus.publish(makeEvent({
            type: 'task.sync',
            source: 'mission_control',
            agent_id: 'observatory',
            session_id: 'mission_control_sync',
            data: {
              id: 'T-400',
              title: 'Audit trail coverage',
              status: 'assigned',
              priority: 'medium',
              updated_at: Math.floor(Date.now() / 1000),
            },
          }));

          const commentRes = await request(governanceInstance.app)
            .post('/api/v2/tasks/T-400/comments')
            .send({
              author_agent_id: 'agent-audit',
              body: 'Leaving an activity trail.',
            });

          expect(commentRes.status).toBe(201);

          const approvalRes = await request(governanceInstance.app)
            .post('/api/v2/approvals')
            .send({
              type: 'budget_override',
              requested_by: 'agent-audit',
              payload: { requested_budget_cents: 2500 },
            });

          expect(approvalRes.status).toBe(201);

          const taskActivities = await request(governanceInstance.app)
            .get('/api/v2/activities?entity_type=task&entity_id=T-400&actor_type=agent&limit=10');

          expect(taskActivities.status).toBe(200);
          expect(taskActivities.body.total).toBeGreaterThanOrEqual(1);
          expect(taskActivities.body.activities.some((activity: { type: string; actor_type: string; entity_id: string }) =>
            activity.type === 'task_comment'
            && activity.actor_type === 'agent'
            && activity.entity_id === 'T-400')).toBe(true);

          const approvalActivities = await request(governanceInstance.app)
            .get('/api/v2/activities?entity_type=approval&actor_type=agent&limit=10');

          expect(approvalActivities.status).toBe(200);
          expect(approvalActivities.body.activities.some((activity: { type: string; entity_type: string }) =>
            activity.type === 'approval_requested'
            && activity.entity_type === 'approval')).toBe(true);
        } finally {
          governanceInstance.close();
          governanceInstance.server.close();
          governanceInstance.io.close();
        }
    });

    it('should list adapters and test a registered adapter', async () => {
        const governanceInstance = createApp({
          featureFlags: {
            ...DEFAULT_FEATURE_FLAGS,
            tasks_v2: true,
          },
        });

        try {
          const listRes = await request(governanceInstance.app).get('/api/v2/adapters');
          expect(listRes.status).toBe(200);
          expect(listRes.body.total).toBe(4);
          expect(listRes.body.adapters.map((adapter: { type: string }) => adapter.type)).toEqual(
            expect.arrayContaining(['mission_control', 'claude_code', 'openclaw', 'opencode']),
          );

          const testRes = await request(governanceInstance.app).post('/api/v2/adapters/claude_code/test');
          expect(testRes.status).toBe(200);
          expect(testRes.body.adapter.type).toBe('claude_code');
          expect(testRes.body.adapter.status).toBe('stub');
          expect(testRes.body.result.ok).toBe(false);
        } finally {
          governanceInstance.close();
          governanceInstance.server.close();
          governanceInstance.io.close();
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
