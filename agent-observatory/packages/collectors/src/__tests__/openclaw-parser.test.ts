import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLine, parseLines } from '../openclaw/parser.js';
import type {
  OCSessionHeader,
  OCToolCall,
  OCToolResult,
  OCUserInput,
} from '../openclaw/parser.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

describe('OpenClaw Parser', () => {
  describe('parseLine', () => {
    it('should parse session header', () => {
      const line = JSON.stringify({
        type: 'session',
        version: 7,
        id: 'session-abc123',
        timestamp: '2026-02-27T12:00:00.000Z',
        cwd: '/home/user/project',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as OCSessionHeader;
      expect(r.kind).toBe('session_header');
      expect(r.version).toBe(7);
      expect(r.sessionId).toBe('session-abc123');
      expect(r.cwd).toBe('/home/user/project');
    });

    it('should parse user message', () => {
      const line = JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: null,
        timestamp: '2026-02-27T12:00:01.000Z',
        message: { role: 'user', content: 'Hello world' },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as OCUserInput;
      expect(r.kind).toBe('user_input');
      expect(r.text).toBe('Hello world');
    });

    it('should parse user message with array content', () => {
      const line = JSON.stringify({
        type: 'message',
        id: 'm1',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Test input' }],
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      expect((records[0] as OCUserInput).text).toBe('Test input');
    });

    it('should parse toolCall from assistant message', () => {
      const line = JSON.stringify({
        type: 'message',
        id: 'm2',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tc1',
              name: 'Read',
              input: { file_path: '/src/main.ts' },
            },
          ],
        },
        timestamp: '2026-02-27T13:00:00.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as OCToolCall;
      expect(r.kind).toBe('tool_call');
      expect(r.id).toBe('tc1');
      expect(r.name).toBe('Read');
      expect(r.input).toEqual({ file_path: '/src/main.ts' });
    });

    it('should parse toolUse variant from assistant message', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolUse',
              id: 'tu1',
              name: 'Edit',
              input: { file_path: '/x.ts' },
            },
          ],
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      expect((records[0] as OCToolCall).name).toBe('Edit');
    });

    it('should parse functionCall variant from assistant message', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'functionCall',
              id: 'fc1',
              function: {
                name: 'Bash',
                arguments: { command: 'ls' },
              },
            },
          ],
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as OCToolCall;
      expect(r.name).toBe('Bash');
      expect(r.input).toEqual({ command: 'ls' });
    });

    it('should parse multiple toolCalls (parallel)', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'tc1', name: 'Read', input: {} },
            { type: 'toolCall', id: 'tc2', name: 'Grep', input: { pattern: 'TODO' } },
          ],
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(2);
      expect((records[0] as OCToolCall).id).toBe('tc1');
      expect((records[1] as OCToolCall).id).toBe('tc2');
    });

    it('should parse toolResult message', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'tc1',
          content: 'File contents here',
        },
        timestamp: '2026-02-27T13:00:01.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const r = records[0] as OCToolResult;
      expect(r.kind).toBe('tool_result');
      expect(r.toolCallId).toBe('tc1');
      expect(r.content).toBe('File contents here');
    });

    it('should parse toolResult with toolUseId variant', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'toolResult',
          toolUseId: 'tu1',
          content: 'Result',
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      expect((records[0] as OCToolResult).toolCallId).toBe('tu1');
    });

    it('should parse error toolResult', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'tc_err',
          content: 'Error occurred',
          isError: true,
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      expect((records[0] as OCToolResult).isError).toBe(true);
    });

    it('should ignore compaction entries', () => {
      const line = JSON.stringify({
        type: 'compaction',
        id: 'c1',
        summary: 'User asked about codebase',
      });
      expect(parseLine(line)).toEqual([]);
    });

    it('should ignore branch_summary entries', () => {
      const line = JSON.stringify({
        type: 'branch_summary',
        id: 'bs1',
        summary: 'Branch summary',
      });
      expect(parseLine(line)).toEqual([]);
    });

    it('should ignore custom entries', () => {
      const line = JSON.stringify({
        type: 'custom',
        data: { custom: 'state' },
      });
      expect(parseLine(line)).toEqual([]);
    });

    it('should return empty for invalid JSON', () => {
      expect(parseLine('not json')).toEqual([]);
      expect(parseLine('')).toEqual([]);
    });
  });

  describe('parseLines (fixture files)', () => {
    it('should parse openclaw-sample.jsonl correctly', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'openclaw-sample.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);

      const headers = records.filter((r) => r.kind === 'session_header');
      const userInputs = records.filter((r) => r.kind === 'user_input');

      expect(headers).toHaveLength(1);
      expect((headers[0] as OCSessionHeader).sessionId).toBe('oc-session-abc123');
      expect((headers[0] as OCSessionHeader).version).toBe(7);
      expect(userInputs).toHaveLength(2);
      // compaction and custom should be ignored
      // invalid json should be ignored
    });

    it('should parse openclaw-with-tools.jsonl correctly', () => {
      const content = readFileSync(
        resolve(FIXTURES, 'openclaw-with-tools.jsonl'),
        'utf-8',
      );
      const records = parseLines(content);

      const headers = records.filter((r) => r.kind === 'session_header');
      const toolCalls = records.filter((r) => r.kind === 'tool_call');
      const toolResults = records.filter((r) => r.kind === 'tool_result');
      const userInputs = records.filter((r) => r.kind === 'user_input');

      expect(headers).toHaveLength(1);
      expect(userInputs).toHaveLength(1);
      expect(toolCalls).toHaveLength(4); // Read, Grep, Edit, Bash
      expect(toolResults).toHaveLength(4); // 4 results

      // Check error result
      const errorResults = toolResults.filter(
        (r) => (r as OCToolResult).isError,
      );
      expect(errorResults).toHaveLength(1);
      expect((errorResults[0] as OCToolResult).toolCallId).toBe('fc1');
    });

    it('should handle empty file gracefully', () => {
      expect(parseLines('')).toHaveLength(0);
    });
  });
});
