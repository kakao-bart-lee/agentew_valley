import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { makeSessionStart, makeToolStart, makeMetricsUsage, makeEvent } from './helpers.js';

describe('Session Replay API', () => {
  let instance: AppInstance;

  beforeEach(() => {
    instance = createApp();
  });

  afterEach(() => {
    instance.close();
    instance.server.close();
    instance.io.close();
  });

  it('should return 404 for unknown session', async () => {
    const res = await request(instance.app).get('/api/v1/sessions/unknown/replay');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SESSION_NOT_FOUND');
  });

  it('should return replay events in time order', async () => {
    const baseTime = new Date('2026-02-27T10:00:00.000Z');

    instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
      ts: baseTime.toISOString(),
      project_id: 'moonlit',
      task_id: 'task-42',
      goal_id: 'goal-7',
    }));
    instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 1000).toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 3000).toISOString(),
    }));

    const res = await request(instance.app).get('/api/v1/sessions/sess-1/replay');
    expect(res.status).toBe(200);
    expect(res.body.session_id).toBe('sess-1');
    expect(res.body.events).toHaveLength(3);
    expect(res.body.total_events).toBe(3);
    expect(res.body.summary.project_id).toBe('moonlit');
    expect(res.body.summary.task_id).toBe('task-42');
    expect(res.body.summary.goal_id).toBe('goal-7');
  });

  it('should compute gap_ms and offset_ms correctly', async () => {
    const baseTime = new Date('2026-02-27T10:00:00.000Z');

    instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
      ts: baseTime.toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 1000).toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 3000).toISOString(),
    }));

    const res = await request(instance.app).get('/api/v1/sessions/sess-1/replay');

    // First event: offset=0, gap=0 (session start itself)
    expect(res.body.events[0].offset_ms).toBe(0);
    expect(res.body.events[0].gap_ms).toBe(0);

    // Second event: 1000ms after start
    expect(res.body.events[1].offset_ms).toBe(1000);
    expect(res.body.events[1].gap_ms).toBe(1000);

    // Third event: 3000ms after start, 2000ms after previous
    expect(res.body.events[2].offset_ms).toBe(3000);
    expect(res.body.events[2].gap_ms).toBe(2000);
  });

  it('should filter by from/to time range', async () => {
    const baseTime = new Date('2026-02-27T10:00:00.000Z');

    instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
      ts: baseTime.toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 1000).toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 5000).toISOString(),
    }));

    const from = new Date(baseTime.getTime() + 500).toISOString();
    const to = new Date(baseTime.getTime() + 2000).toISOString();
    const res = await request(instance.app).get(
      `/api/v1/sessions/sess-1/replay?from=${from}&to=${to}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.time_range).toBeDefined();
    expect(res.body.time_range.from).toBe(from);
    expect(res.body.time_range.to).toBe(to);
  });

  it('should filter by event types', async () => {
    instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1'));
    instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, { session_id: 'sess-1' }));
    instance.eventBus.publish(makeEvent({ type: 'tool.end', agent_id: 'agent-1', session_id: 'sess-1' }));
    instance.eventBus.publish(makeMetricsUsage(100, 0.05, 'agent-1', { session_id: 'sess-1' }));

    const res = await request(instance.app).get(
      '/api/v1/sessions/sess-1/replay?types=tool.start,tool.end',
    );

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    const types = res.body.events.map((e: { event: { type: string } }) => e.event.type);
    expect(types).toContain('tool.start');
    expect(types).toContain('tool.end');
  });

  it('should include summary with duration_ms and event_type_counts', async () => {
    const baseTime = new Date('2026-02-27T10:00:00.000Z');

    instance.eventBus.publish(makeSessionStart('agent-1', 'sess-1', {
      ts: baseTime.toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Read', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 2000).toISOString(),
    }));
    instance.eventBus.publish(makeToolStart('Bash', 'agent-1', undefined, {
      session_id: 'sess-1',
      ts: new Date(baseTime.getTime() + 5000).toISOString(),
    }));

    const res = await request(instance.app).get('/api/v1/sessions/sess-1/replay');

    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.agent_id).toBe('agent-1');
    expect(res.body.summary.duration_ms).toBe(5000);
    expect(res.body.summary.total_events).toBe(3);
    expect(res.body.summary.event_type_counts['session.start']).toBe(1);
    expect(res.body.summary.event_type_counts['tool.start']).toBe(2);
  });
});
