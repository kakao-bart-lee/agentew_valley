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
import type { CCToolUse, CCToolResult, CCTurnDuration, CCUserInput, CCSubagentProgress, CCUsage } from '../claude-code/parser.js';

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

    it('should normalize usage to metrics.usage event with tokens and cost', () => {
      const record: CCUsage = {
        kind: 'usage',
        inputTokens: 1024,
        outputTokens: 256,
        costUsd: 0.005,
        timestamp: '2026-02-27T10:00:03.000Z',
      };

      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);
      const events = normalize(record, freshCtx);
      expect(events).toHaveLength(1);
      const e = events[0];
      expect(e.type).toBe('metrics.usage');
      expect(e.data?.tokens).toBe(1280); // 1024 + 256
      expect(e.data?.input_tokens).toBe(1024);
      expect(e.data?.output_tokens).toBe(256);
      expect(e.data?.cost).toBe(0.005);
    });

    it('should normalize usage without cost (no costUSD field)', () => {
      const record: CCUsage = {
        kind: 'usage',
        inputTokens: 512,
        outputTokens: 128,
        timestamp: '2026-02-27T10:00:01.000Z',
      };

      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);
      const events = normalize(record, freshCtx);
      expect(events).toHaveLength(1);
      expect(events[0].data?.cost).toBeUndefined();
      expect(events[0].data?.tokens).toBe(640);
    });

    it('should normalize first subagent_progress to spawn + session.start + nested events', () => {
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

      // subagent.spawn (parent) + session.start (sub) + tool.start (sub)
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('subagent.spawn');
      expect(events[0].agent_id).toBe('cc-abcd1234'); // parent
      expect(events[0].parent_span_id).toBe('toolu_task1');
      expect(events[0].data?.child_agent_id).toBe('cc-abcd1234-s1');

      expect(events[1].type).toBe('session.start');
      expect(events[1].agent_id).toBe('cc-abcd1234-s1'); // sub-agent
      expect(events[1].data?.parent_agent_id).toBe('cc-abcd1234');

      expect(events[2].type).toBe('tool.start');
      expect(events[2].agent_id).toBe('cc-abcd1234-s1'); // sub-agent
      expect(events[2].data?.tool_name).toBe('Read');
    });

    it('should emit session.end for sub-agent when parent tool_result arrives', () => {
      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);

      // spawn sub-agent
      const progress: CCSubagentProgress = {
        kind: 'subagent_progress',
        parentToolUseId: 'toolu_task1',
        nestedRecords: [{ kind: 'tool_use', id: 'sub_r1', name: 'Read', input: {}, timestamp: '2026-02-27T11:00:01.000Z' }],
        timestamp: '2026-02-27T11:00:01.000Z',
      };
      normalize(progress, freshCtx);

      // parent Task tool completes
      const toolResult: CCToolResult = {
        kind: 'tool_result',
        toolUseId: 'toolu_task1',
        content: 'Task done',
        timestamp: '2026-02-27T11:00:10.000Z',
      };
      const events = normalize(toolResult, freshCtx);

      // session.end (sub-agent) + tool.end (parent)
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('session.end');
      expect(events[0].agent_id).toBe('cc-abcd1234-s1');
      expect(events[1].type).toBe('tool.end');
      expect(events[1].agent_id).toBe('cc-abcd1234');

      // 컨텍스트 정리됨 — 이후 동일 toolUseId로 tool_result가 와도 session.end 중복 없음
      expect(freshCtx.subContexts.has('toolu_task1')).toBe(false);
    });

    it('should reuse sub-agent context on subsequent progress for same parentToolUseId', () => {
      const freshCtx = createContext('/path/to/abcd1234-5678.jsonl', 1);

      const firstProgress: CCSubagentProgress = {
        kind: 'subagent_progress',
        parentToolUseId: 'toolu_task1',
        nestedRecords: [{ kind: 'tool_use', id: 'sub_r1', name: 'Read', input: {}, timestamp: '2026-02-27T11:00:01.000Z' }],
        timestamp: '2026-02-27T11:00:01.000Z',
      };
      const secondProgress: CCSubagentProgress = {
        kind: 'subagent_progress',
        parentToolUseId: 'toolu_task1',
        nestedRecords: [{ kind: 'tool_use', id: 'sub_g1', name: 'Grep', input: {}, timestamp: '2026-02-27T11:00:02.000Z' }],
        timestamp: '2026-02-27T11:00:02.000Z',
      };

      const events1 = normalize(firstProgress, freshCtx);
      const events2 = normalize(secondProgress, freshCtx);

      // 두 번째 progress: spawn/session.start 없이 tool.start만
      expect(events2).toHaveLength(1);
      expect(events2[0].type).toBe('tool.start');
      expect(events2[0].data?.tool_name).toBe('Grep');
      // 같은 서브에이전트 ID 사용
      expect(events2[0].agent_id).toBe(events1[1].agent_id); // events1[1] = session.start
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
      const metricsUsage = events.filter((e) => e.type === 'metrics.usage');

      expect(toolStarts).toHaveLength(4);
      expect(toolEnds).toHaveLength(4);
      expect(statuses).toHaveLength(1);
      expect(userInputs).toHaveLength(1);
      // fixture의 3개 assistant 메시지 중 3개 모두 usage 데이터 포함
      expect(metricsUsage).toHaveLength(3);
      // 비용 있는 메시지 (costUSD 포함된 첫 두 assistant 메시지)
      const withCost = metricsUsage.filter((e) => typeof e.data?.cost === 'number');
      expect(withCost).toHaveLength(2);
      // 토큰 합계 검증 (1024+256=1280 for second assistant msg)
      expect(metricsUsage[1].data?.tokens).toBe(1280);

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

      // toolu_task1에 대해 progress가 2번 오지만 spawn은 1번만
      const spawns = events.filter((e) => e.type === 'subagent.spawn');
      expect(spawns).toHaveLength(1);
      expect(spawns[0].parent_span_id).toBe('toolu_task1');
      expect(spawns[0].data?.child_agent_id).toBe('cc-sub12345-s1');

      // 서브에이전트 session.start 1회
      const subStarts = events.filter((e) => e.type === 'session.start');
      expect(subStarts).toHaveLength(1);
      expect(subStarts[0].agent_id).toBe('cc-sub12345-s1');
      expect(subStarts[0].data?.parent_agent_id).toBe('cc-sub12345');

      // 서브에이전트 도구 이벤트는 서브에이전트 agent_id로 발행됨
      const subToolStarts = events.filter(
        (e) => e.type === 'tool.start' && e.agent_id === 'cc-sub12345-s1',
      );
      expect(subToolStarts).toHaveLength(2); // Read + Grep
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
