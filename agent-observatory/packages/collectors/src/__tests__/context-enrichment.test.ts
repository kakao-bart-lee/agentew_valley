import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enrichWithContext, readContextFromEnv } from '../base.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';

function makeEvent(overrides: Partial<UAEPEvent> = {}): UAEPEvent {
  return {
    event_id: generateEventId(),
    agent_id: 'test-agent',
    session_id: 'test-session',
    ts: new Date().toISOString(),
    source: 'claude_code',
    type: 'session.start',
    ...overrides,
  };
}

describe('readContextFromEnv', () => {
  const envKeys = ['OBSERVATORY_TASK_ID', 'OBSERVATORY_PROJECT_ID', 'OBSERVATORY_GOAL_ID'] as const;

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('returns all undefined when env vars are not set', () => {
    const ctx = readContextFromEnv();
    expect(ctx.task_id).toBeUndefined();
    expect(ctx.project_id).toBeUndefined();
    expect(ctx.goal_id).toBeUndefined();
  });

  it('reads OBSERVATORY_TASK_ID', () => {
    process.env['OBSERVATORY_TASK_ID'] = 'T-123';
    const ctx = readContextFromEnv();
    expect(ctx.task_id).toBe('T-123');
  });

  it('reads all three env vars', () => {
    process.env['OBSERVATORY_TASK_ID'] = 'T-42';
    process.env['OBSERVATORY_PROJECT_ID'] = 'moonlit';
    process.env['OBSERVATORY_GOAL_ID'] = 'G-001';
    const ctx = readContextFromEnv();
    expect(ctx.task_id).toBe('T-42');
    expect(ctx.project_id).toBe('moonlit');
    expect(ctx.goal_id).toBe('G-001');
  });

  it('treats empty string as undefined', () => {
    process.env['OBSERVATORY_TASK_ID'] = '';
    const ctx = readContextFromEnv();
    expect(ctx.task_id).toBeUndefined();
  });
});

describe('enrichWithContext', () => {
  it('returns event unchanged when ctx is empty', () => {
    const event = makeEvent();
    const result = enrichWithContext(event, {});
    expect(result).toBe(event); // same reference — no spread
  });

  it('attaches task_id/project_id/goal_id from ctx', () => {
    const event = makeEvent();
    const result = enrichWithContext(event, {
      task_id: 'T-123',
      project_id: 'moonlit',
      goal_id: 'G-001',
    });
    expect(result.task_id).toBe('T-123');
    expect(result.project_id).toBe('moonlit');
    expect(result.goal_id).toBe('G-001');
  });

  it('does not overwrite existing event context values', () => {
    const event = makeEvent({ task_id: 'T-event', project_id: 'proj-event' });
    const result = enrichWithContext(event, {
      task_id: 'T-env',
      project_id: 'proj-env',
      goal_id: 'G-env',
    });
    // 이벤트의 기존 값 유지
    expect(result.task_id).toBe('T-event');
    expect(result.project_id).toBe('proj-event');
    // goal_id는 이벤트에 없으므로 env 값 적용
    expect(result.goal_id).toBe('G-env');
  });

  it('partially enriches when ctx has only some fields', () => {
    const event = makeEvent();
    const result = enrichWithContext(event, { project_id: 'moonlit' });
    expect(result.task_id).toBeUndefined();
    expect(result.project_id).toBe('moonlit');
    expect(result.goal_id).toBeUndefined();
  });
});
