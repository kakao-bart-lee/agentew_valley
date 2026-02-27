import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLines } from '../claude-code/parser.js';
import {
  normalize,
  normalizeAll,
  createContext,
  extractSessionId,
  buildAgentId,
} from '../claude-code/normalizer.js';
import type { CCToolUse, CCToolResult, CCTurnDuration, CCUserInput, CCSubagentProgress } from '../claude-code/parser.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

describe('Claude Code Normalizer', () => {
  describe('extractSessionId', () => {
    it('should extract session ID from file path', () => {
      expect(
        extractSessionId('/home/.claude/projects/abc/12345678-abcd-1234-abcd-123456789abc.jsonl'),
      ).toBe('12345678-abcd-1234-abcd-123456789abc');
    });

    it('should handle path without directory', () => {
      expect(extractSessionId('session.jsonl')).toBe('session');
    });
  });

  describe('buildAgentId', () => {
    it('should build agent ID with cc- prefix', () => {
      expect(buildAgentId('12345678-abcd')).toBe('cc-12345678');
    });
  });

  describe('normalize', () => {
    const ctx = createContext('/path/to/abcd1234-5678.jsonl', 1);

    it('should normalize tool_use to tool.start event', () => {
      const record: CCToolUse = {
        kind: 'tool_use',
        id: 'toolu_1',
        name: 'Read',
        input: { file_path: '/src/main.ts' },
        timestamp: '2026-02-27T10:00:00.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      const e = events[0];
      expect(e.type).toBe('tool.start');
      expect(e.source).toBe('claude_code');
      expect(e.agent_id).toBe('cc-abcd1234');
      expect(e.session_id).toBe('abcd1234-5678');
      expect(e.span_id).toBe('toolu_1');
      expect(e.data?.tool_name).toBe('Read');
      expect(e.data?.tool_category).toBe('file_read');
      expect(e.data?.input_summary).toBe('/src/main.ts');
    });

    it('should normalize tool_result to tool.end event with duration', () => {
      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);

      // First register tool start
      const toolUse: CCToolUse = {
        kind: 'tool_use',
        id: 'toolu_dur',
        name: 'Bash',
        input: { command: 'npm test' },
        timestamp: '2026-02-27T10:00:00.000Z',
      };
      normalize(toolUse, freshCtx);

      // Then tool end
      const toolResult: CCToolResult = {
        kind: 'tool_result',
        toolUseId: 'toolu_dur',
        content: 'All tests passed',
        timestamp: '2026-02-27T10:00:05.000Z',
      };
      const events = normalize(toolResult, freshCtx);
      expect(events).toHaveLength(1);
      const e = events[0];
      expect(e.type).toBe('tool.end');
      expect(e.span_id).toBe('toolu_dur');
      expect(e.data?.duration_ms).toBe(5000);
    });

    it('should normalize error tool_result to tool.error event', () => {
      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);

      const toolResult: CCToolResult = {
        kind: 'tool_result',
        toolUseId: 'toolu_err',
        content: 'Error: file not found',
        isError: true,
        timestamp: '2026-02-27T10:00:01.000Z',
      };
      const events = normalize(toolResult, freshCtx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('tool.error');
      expect(events[0].data?.error).toBe('Error: file not found');
    });

    it('should normalize turn_duration to agent.status idle', () => {
      const record: CCTurnDuration = {
        kind: 'turn_duration',
        durationMs: 5000,
        timestamp: '2026-02-27T10:00:10.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('agent.status');
      expect(events[0].data?.status).toBe('idle');
      expect(events[0].data?.duration_ms).toBe(5000);
    });

    it('should normalize user_input to user.input event', () => {
      const record: CCUserInput = {
        kind: 'user_input',
        text: 'Fix the bug',
        timestamp: '2026-02-27T10:00:00.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('user.input');
      expect(events[0].data?.text_length).toBe(11);
    });

    it('should normalize subagent_progress to subagent.spawn + nested events', () => {
      const record: CCSubagentProgress = {
        kind: 'subagent_progress',
        parentToolUseId: 'toolu_task1',
        nestedRecords: [
          {
            kind: 'tool_use',
            id: 'toolu_sub1',
            name: 'Read',
            input: { file_path: '/x.ts' },
            timestamp: '2026-02-27T11:00:00.000Z',
          },
        ],
        timestamp: '2026-02-27T11:00:00.000Z',
      };

      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);
      const events = normalize(record, freshCtx);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('subagent.spawn');
      expect(events[0].parent_span_id).toBe('toolu_task1');
      expect(events[1].type).toBe('tool.start');
      expect(events[1].data?.tool_name).toBe('Read');
    });
  });

  describe('normalizeAll with fixture', () => {
    it('should normalize claude-code-sample.jsonl', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'claude-code-sample.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);
      const ctx = createContext(
        '/home/.claude/projects/abc/a1b2c3d4-test.jsonl',
        1,
      );
      const events = normalizeAll(records, ctx);

      // Should have events for:
      // user.input, 4x tool.start, 4x tool.end, 1x agent.status
      expect(events.length).toBeGreaterThanOrEqual(10);

      const toolStarts = events.filter((e) => e.type === 'tool.start');
      const toolEnds = events.filter((e) => e.type === 'tool.end');
      const statuses = events.filter((e) => e.type === 'agent.status');
      const userInputs = events.filter((e) => e.type === 'user.input');

      expect(toolStarts).toHaveLength(4);
      expect(toolEnds).toHaveLength(4);
      expect(statuses).toHaveLength(1);
      expect(userInputs).toHaveLength(1);

      // All events should have consistent source and agent_id
      for (const event of events) {
        expect(event.source).toBe('claude_code');
        expect(event.agent_id).toBe('cc-a1b2c3d4');
        expect(event.session_id).toBe('a1b2c3d4-test');
        expect(event.event_id).toBeTruthy();
        expect(event.ts).toBeTruthy();
      }
    });

    it('should normalize subagent fixture', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'claude-code-subagent.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);
      const ctx = createContext('/path/to/sub12345-test.jsonl', 1);
      const events = normalizeAll(records, ctx);

      const spawns = events.filter((e) => e.type === 'subagent.spawn');
      expect(spawns).toHaveLength(2);
      expect(spawns[0].parent_span_id).toBe('toolu_task1');
    });

    it('should assign sequential seq numbers', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'claude-code-sample.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);
      const ctx = createContext('/path/to/seq-test.jsonl', 1);
      const events = normalizeAll(records, ctx);

      for (let i = 0; i < events.length; i++) {
        expect(events[i].seq).toBe(i + 1);
      }
    });
  });
});
