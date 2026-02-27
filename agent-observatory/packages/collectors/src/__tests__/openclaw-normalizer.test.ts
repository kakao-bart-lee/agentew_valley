import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLines } from '../openclaw/parser.js';
import {
  normalize,
  normalizeAll,
  createContext,
  buildAgentId,
} from '../openclaw/normalizer.js';
import type { OCSessionHeader, OCToolCall, OCToolResult, OCUserInput } from '../openclaw/parser.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

describe('OpenClaw Normalizer', () => {
  describe('buildAgentId', () => {
    it('should build agent ID with oc- prefix', () => {
      expect(buildAgentId('myagent-12345')).toBe('oc-myagent-');
    });

    it('should handle short agent ID', () => {
      expect(buildAgentId('ab')).toBe('oc-ab');
    });
  });

  describe('normalize', () => {
    const ctx = createContext('test-agent-id', 'session-xyz');

    it('should normalize session_header to session.start', () => {
      const record: OCSessionHeader = {
        kind: 'session_header',
        version: 7,
        sessionId: 'oc-session-123',
        cwd: '/home/user',
        timestamp: '2026-02-27T12:00:00.000Z',
      };

      const freshCtx = createContext('test-agent', 'initial');
      const events = normalize(record, freshCtx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('session.start');
      expect(events[0].source).toBe('openclaw');
      expect(events[0].data?.version).toBe(7);
      expect(events[0].data?.cwd).toBe('/home/user');
      // Context should be updated with session ID from header
      expect(freshCtx.sessionId).toBe('oc-session-123');
    });

    it('should normalize tool_call to tool.start', () => {
      const record: OCToolCall = {
        kind: 'tool_call',
        id: 'tc1',
        name: 'Read',
        input: { file_path: '/src/main.ts' },
        timestamp: '2026-02-27T13:00:00.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      const e = events[0];
      expect(e.type).toBe('tool.start');
      expect(e.source).toBe('openclaw');
      expect(e.span_id).toBe('tc1');
      expect(e.data?.tool_name).toBe('Read');
      expect(e.data?.tool_category).toBe('file_read');
      expect(e.data?.input_summary).toBe('/src/main.ts');
    });

    it('should normalize tool_result to tool.end with duration', () => {
      const freshCtx = createContext('agent1', 'session1');

      // Register tool start
      const toolCall: OCToolCall = {
        kind: 'tool_call',
        id: 'tc_dur',
        name: 'Bash',
        input: { command: 'npm test' },
        timestamp: '2026-02-27T13:00:00.000Z',
      };
      normalize(toolCall, freshCtx);

      // Tool result
      const toolResult: OCToolResult = {
        kind: 'tool_result',
        toolCallId: 'tc_dur',
        content: 'Tests passed',
        timestamp: '2026-02-27T13:00:03.000Z',
      };
      const events = normalize(toolResult, freshCtx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool.end');
      expect(events[0].span_id).toBe('tc_dur');
      expect(events[0].data?.duration_ms).toBe(3000);
    });

    it('should normalize error tool_result to tool.error', () => {
      const freshCtx = createContext('agent1', 'session1');

      const record: OCToolResult = {
        kind: 'tool_result',
        toolCallId: 'tc_err',
        content: 'Command failed',
        isError: true,
        timestamp: '2026-02-27T13:00:01.000Z',
      };

      const events = normalize(record, freshCtx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool.error');
      expect(events[0].data?.error).toBe('Command failed');
    });

    it('should normalize user_input', () => {
      const record: OCUserInput = {
        kind: 'user_input',
        text: 'Fix the login bug',
        timestamp: '2026-02-27T13:00:00.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('user.input');
      expect(events[0].data?.text_length).toBe(17);
    });
  });

  describe('normalizeAll with fixture', () => {
    it('should normalize openclaw-with-tools.jsonl', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'openclaw-with-tools.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);
      const ctx = createContext('agent-abc', 'initial-session');
      const events = normalizeAll(records, ctx);

      // session.start from header
      // user.input
      // 4x tool.start
      // 4x tool.end (3 normal + 1 error)
      expect(events.length).toBeGreaterThanOrEqual(10);

      const sessionStarts = events.filter((e) => e.type === 'session.start');
      const toolStarts = events.filter((e) => e.type === 'tool.start');
      const toolEnds = events.filter((e) => e.type === 'tool.end');
      const toolErrors = events.filter((e) => e.type === 'tool.error');
      const userInputs = events.filter((e) => e.type === 'user.input');

      expect(sessionStarts).toHaveLength(1);
      expect(userInputs).toHaveLength(1);
      expect(toolStarts).toHaveLength(4);
      expect(toolEnds).toHaveLength(3);
      expect(toolErrors).toHaveLength(1);

      // All events should have openclaw source
      for (const event of events) {
        expect(event.source).toBe('openclaw');
        expect(event.agent_id).toBe('oc-agent-ab');
        expect(event.event_id).toBeTruthy();
        expect(event.ts).toBeTruthy();
      }

      // After header processing, session_id should be updated
      expect(ctx.sessionId).toBe('oc-session-def456');
    });

    it('should normalize openclaw-sample.jsonl', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'openclaw-sample.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);
      const ctx = createContext('sample-agent', '');
      const events = normalizeAll(records, ctx);

      const sessionStarts = events.filter((e) => e.type === 'session.start');
      const userInputs = events.filter((e) => e.type === 'user.input');

      expect(sessionStarts).toHaveLength(1);
      expect(userInputs).toHaveLength(2);
    });

    it('should assign sequential seq numbers', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'openclaw-with-tools.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);
      const ctx = createContext('seq-agent', '');
      const events = normalizeAll(records, ctx);

      for (let i = 0; i < events.length; i++) {
        expect(events[i].seq).toBe(i + 1);
      }
    });
  });
});
