import { describe, it, expect } from 'vitest';
import {
  validateUAEPEvent,
  isValidUAEPEvent,
  isValidSourceType,
  isValidEventType,
} from '../utils/validation.js';
import type { UAEPEvent } from '../types/uaep.js';

function createValidEvent(overrides?: Partial<UAEPEvent>): UAEPEvent {
  return {
    ts: '2026-02-27T10:30:00Z',
    event_id: '01912345-6789-7abc-8def-0123456789ab',
    source: 'claude_code',
    agent_id: 'agent-1',
    session_id: 'session-1',
    type: 'tool.start',
    ...overrides,
  };
}

describe('isValidSourceType', () => {
  it('should accept valid source types', () => {
    expect(isValidSourceType('claude_code')).toBe(true);
    expect(isValidSourceType('openclaw')).toBe(true);
    expect(isValidSourceType('agent_sdk')).toBe(true);
    expect(isValidSourceType('langchain')).toBe(true);
    expect(isValidSourceType('crewai')).toBe(true);
    expect(isValidSourceType('custom')).toBe(true);
  });

  it('should reject invalid source types', () => {
    expect(isValidSourceType('unknown')).toBe(false);
    expect(isValidSourceType('')).toBe(false);
    expect(isValidSourceType(123)).toBe(false);
    expect(isValidSourceType(null)).toBe(false);
  });
});

describe('isValidEventType', () => {
  it('should accept valid event types', () => {
    expect(isValidEventType('session.start')).toBe(true);
    expect(isValidEventType('session.end')).toBe(true);
    expect(isValidEventType('tool.start')).toBe(true);
    expect(isValidEventType('tool.end')).toBe(true);
    expect(isValidEventType('tool.error')).toBe(true);
    expect(isValidEventType('agent.status')).toBe(true);
    expect(isValidEventType('llm.start')).toBe(true);
    expect(isValidEventType('llm.end')).toBe(true);
    expect(isValidEventType('user.input')).toBe(true);
    expect(isValidEventType('user.permission')).toBe(true);
    expect(isValidEventType('subagent.spawn')).toBe(true);
    expect(isValidEventType('subagent.end')).toBe(true);
    expect(isValidEventType('metrics.usage')).toBe(true);
  });

  it('should reject invalid event types', () => {
    expect(isValidEventType('tool.unknown')).toBe(false);
    expect(isValidEventType('')).toBe(false);
    expect(isValidEventType(42)).toBe(false);
  });
});

describe('validateUAEPEvent', () => {
  it('should pass for a valid event', () => {
    const result = validateUAEPEvent(createValidEvent());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should pass for event with all optional fields', () => {
    const result = validateUAEPEvent(createValidEvent({
      seq: 1,
      agent_name: 'Test Agent',
      span_id: 'span-1',
      parent_span_id: 'span-0',
      team_id: 'team-1',
      data: { tool_name: 'Read' },
      metadata: { raw_type: 'assistant' },
    }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should fail for null/undefined input', () => {
    expect(validateUAEPEvent(null).valid).toBe(false);
    expect(validateUAEPEvent(undefined).valid).toBe(false);
    expect(validateUAEPEvent('string').valid).toBe(false);
    expect(validateUAEPEvent(42).valid).toBe(false);
  });

  it('should fail for missing required fields', () => {
    const result = validateUAEPEvent({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });

  it('should fail for invalid ts', () => {
    const result = validateUAEPEvent(createValidEvent({ ts: 'not-a-date' as string }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ts: must be a valid ISO-8601 timestamp string');
  });

  it('should fail for empty event_id', () => {
    const result = validateUAEPEvent(createValidEvent({ event_id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('event_id: must be a non-empty string');
  });

  it('should fail for invalid source type', () => {
    const result = validateUAEPEvent(createValidEvent({ source: 'invalid' as 'claude_code' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.startsWith('source:'))).toBe(true);
  });

  it('should fail for empty agent_id', () => {
    const result = validateUAEPEvent(createValidEvent({ agent_id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('agent_id: must be a non-empty string');
  });

  it('should fail for invalid event type', () => {
    const result = validateUAEPEvent(createValidEvent({ type: 'invalid.type' as 'tool.start' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.startsWith('type:'))).toBe(true);
  });

  it('should fail for invalid optional field types', () => {
    const result = validateUAEPEvent({
      ...createValidEvent(),
      seq: 'not-a-number' as unknown as number,
      agent_name: 123 as unknown as string,
      span_id: 456 as unknown as string,
      data: 'not-an-object' as unknown as Record<string, unknown>,
      metadata: [1, 2, 3] as unknown as Record<string, unknown>,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('seq: must be a number if provided');
    expect(result.errors).toContain('agent_name: must be a string if provided');
    expect(result.errors).toContain('span_id: must be a string if provided');
    expect(result.errors).toContain('data: must be a plain object if provided');
    expect(result.errors).toContain('metadata: must be a plain object if provided');
  });
});

describe('isValidUAEPEvent', () => {
  it('should return true for valid events', () => {
    expect(isValidUAEPEvent(createValidEvent())).toBe(true);
  });

  it('should return false for invalid events', () => {
    expect(isValidUAEPEvent({})).toBe(false);
    expect(isValidUAEPEvent(null)).toBe(false);
  });

  it('should work as a type guard', () => {
    const unknown: unknown = createValidEvent();
    if (isValidUAEPEvent(unknown)) {
      // TypeScript should recognize unknown as UAEPEvent here
      const _ts: string = unknown.ts;
      const _type: string = unknown.type;
      expect(_ts).toBeDefined();
      expect(_type).toBeDefined();
    }
  });
});
