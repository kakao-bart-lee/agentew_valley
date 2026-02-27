import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLine, parseLines } from '../claude-code/parser.js';
import type {
  CCToolUse,
  CCToolResult,
  CCTurnDuration,
  CCUserInput,
  CCSubagentProgress,
  CCUsage,
} from '../claude-code/parser.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

describe('Claude Code Parser', () => {
  describe('parseLine', () => {
    it('should parse tool_use from assistant message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: '/src/main.ts' },
            },
          ],
        },
        timestamp: '2026-02-27T10:00:00.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCToolUse;
      expect(r.kind).toBe('tool_use');
      expect(r.id).toBe('toolu_1');
      expect(r.name).toBe('Read');
      expect(r.input).toEqual({ file_path: '/src/main.ts' });
      expect(r.timestamp).toBe('2026-02-27T10:00:00.000Z');
    });

    it('should parse multiple tool_use (parallel) from a single assistant message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_a', name: 'Edit', input: {} },
            { type: 'tool_use', id: 'toolu_b', name: 'Grep', input: { pattern: 'TODO' } },
          ],
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(2);
      expect(records[0].kind).toBe('tool_use');
      expect((records[0] as CCToolUse).id).toBe('toolu_a');
      expect(records[1].kind).toBe('tool_use');
      expect((records[1] as CCToolUse).id).toBe('toolu_b');
    });

    it('should parse tool_result from user message', () => {
      const line = JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [{ type: 'text', text: 'file content here' }],
            },
          ],
        },
        timestamp: '2026-02-27T10:00:01.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCToolResult;
      expect(r.kind).toBe('tool_result');
      expect(r.toolUseId).toBe('toolu_1');
      expect(r.content).toBe('file content here');
    });

    it('should parse tool_result with is_error flag', () => {
      const line = JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_err',
              content: [{ type: 'text', text: 'Error: file not found' }],
              is_error: true,
            },
          ],
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCToolResult;
      expect(r.isError).toBe(true);
    });

    it('should parse user input from user message without tool_result', () => {
      const line = JSON.stringify({
        type: 'user',
        message: {
          content: [{ type: 'text', text: 'Fix the bug in main.ts' }],
        },
        timestamp: '2026-02-27T10:00:00.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCUserInput;
      expect(r.kind).toBe('user_input');
      expect(r.text).toBe('Fix the bug in main.ts');
    });

    it('should parse user input from string content', () => {
      const line = JSON.stringify({
        type: 'user',
        message: { content: 'Hello world' },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      expect((records[0] as CCUserInput).text).toBe('Hello world');
    });

    it('should parse turn_duration system record', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'turn_duration',
        duration_ms: 5000,
        timestamp: '2026-02-27T10:00:10.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCTurnDuration;
      expect(r.kind).toBe('turn_duration');
      expect(r.durationMs).toBe(5000);
    });

    it('should parse subagent progress with nested tool_use', () => {
      const line = JSON.stringify({
        type: 'progress',
        parentToolUseID: 'toolu_task1',
        data: {
          type: 'agent_progress',
          message: {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'toolu_sub1', name: 'Read', input: { file_path: '/x.ts' } },
              ],
            },
          },
        },
        timestamp: '2026-02-27T11:00:00.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCSubagentProgress;
      expect(r.kind).toBe('subagent_progress');
      expect(r.parentToolUseId).toBe('toolu_task1');
      expect(r.nestedRecords).toHaveLength(1);
      expect(r.nestedRecords[0].kind).toBe('tool_use');
      expect((r.nestedRecords[0] as CCToolUse).id).toBe('toolu_sub1');
    });

    it('should ignore bash_progress', () => {
      const line = JSON.stringify({
        type: 'progress',
        data: { type: 'bash_progress', output: 'running...' },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(0);
    });

    it('should return empty array for invalid JSON', () => {
      expect(parseLine('this is not json')).toEqual([]);
      expect(parseLine('')).toEqual([]);
      expect(parseLine('  ')).toEqual([]);
    });

    it('should return empty array for unknown type', () => {
      const line = JSON.stringify({ type: 'summary', summary: 'done' });
      expect(parseLine(line)).toEqual([]);
    });

    it('should ignore system records without turn_duration subtype', () => {
      const line = JSON.stringify({ type: 'system', subtype: 'other' });
      expect(parseLine(line)).toEqual([]);
    });

    it('should parse usage from assistant message with message.usage', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [],
          usage: { input_tokens: 1024, output_tokens: 256 },
        },
        costUSD: 0.005,
        timestamp: '2026-02-27T10:00:03.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCUsage;
      expect(r.kind).toBe('usage');
      expect(r.inputTokens).toBe(1024);
      expect(r.outputTokens).toBe(256);
      expect(r.costUsd).toBe(0.005);
      expect(r.timestamp).toBe('2026-02-27T10:00:03.000Z');
    });

    it('should parse usage together with tool_use from the same assistant message', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }],
          usage: { input_tokens: 512, output_tokens: 64 },
        },
        costUSD: 0.002,
        timestamp: '2026-02-27T10:00:01.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(2);
      expect(records[0].kind).toBe('tool_use');
      const usage = records[1] as CCUsage;
      expect(usage.kind).toBe('usage');
      expect(usage.inputTokens).toBe(512);
      expect(usage.outputTokens).toBe(64);
      expect(usage.costUsd).toBe(0.002);
    });

    it('should skip usage record when input_tokens and output_tokens are both 0', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(0);
    });

    it('should parse usage without costUSD (costUsd is undefined)', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        timestamp: '2026-02-27T10:00:05.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as CCUsage;
      expect(r.kind).toBe('usage');
      expect(r.costUsd).toBeUndefined();
    });
  });

  describe('parseLines (fixture files)', () => {
    it('should parse claude-code-sample.jsonl correctly', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'claude-code-sample.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);

      // Expected records from the fixture:
      // 1. user_input ("Fix the bug in main.ts")
      // 2. tool_use (Read, toolu_read1)
      // 3. tool_result (toolu_read1)
      // 4. tool_use (Edit, toolu_edit1), tool_use (Grep, toolu_grep1)
      // 5. tool_result (toolu_edit1), tool_result (toolu_grep1)
      // 6. tool_use (Bash, toolu_bash1)
      // 7. tool_result (toolu_bash1)
      // 8. turn_duration
      // 9. invalid JSON -> skipped
      // 10. summary -> skipped

      const toolUses = records.filter((r) => r.kind === 'tool_use');
      const toolResults = records.filter((r) => r.kind === 'tool_result');
      const turnDurations = records.filter((r) => r.kind === 'turn_duration');
      const userInputs = records.filter((r) => r.kind === 'user_input');

      expect(userInputs).toHaveLength(1);
      expect(toolUses).toHaveLength(4); // Read, Edit, Grep, Bash
      expect(toolResults).toHaveLength(4); // results for all 4
      expect(turnDurations).toHaveLength(1);
      expect((turnDurations[0] as CCTurnDuration).durationMs).toBe(10000);
    });

    it('should parse claude-code-subagent.jsonl correctly', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'claude-code-subagent.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);

      const userInputs = records.filter((r) => r.kind === 'user_input');
      const toolUses = records.filter((r) => r.kind === 'tool_use');
      const subagentProgress = records.filter(
        (r) => r.kind === 'subagent_progress',
      );
      const turnDurations = records.filter((r) => r.kind === 'turn_duration');

      expect(userInputs).toHaveLength(1);
      expect(toolUses).toHaveLength(1); // Task tool_use
      expect(subagentProgress).toHaveLength(2); // 2 agent_progress records
      expect(turnDurations).toHaveLength(1);

      // nested records in subagent progress
      const sp = subagentProgress[0] as CCSubagentProgress;
      expect(sp.parentToolUseId).toBe('toolu_task1');
      expect(sp.nestedRecords).toHaveLength(1);
      expect((sp.nestedRecords[0] as CCToolUse).name).toBe('Read');
    });

    it('should handle empty file gracefully', () => {
      const records = parseLines('');
      expect(records).toHaveLength(0);
    });
  });
});
