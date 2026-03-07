import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLine, parseLines } from '../codex/parser.js';
import { normalize, normalizeAll, createContext, buildAgentId } from '../codex/normalizer.js';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/codex-sample.jsonl');
const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, 'utf-8');

describe('Codex Parser', () => {
  it('parses session_meta', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:12.884Z',
      type: 'session_meta',
      payload: {
        id: '019cc3c8-09e1-7782-ba7a-5be9e059261f',
        timestamp: '2026-03-07T00:33:12.813Z',
        cwd: '/Users/test/project',
        originator: 'codex_cli_rs',
        model_provider: 'openai',
        agent_nickname: 'Sagan',
        agent_role: 'git-master',
        source: 'cli',
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('session_meta');
    if (rec.kind === 'session_meta') {
      expect(rec.id).toBe('019cc3c8-09e1-7782-ba7a-5be9e059261f');
      expect(rec.cwd).toBe('/Users/test/project');
      expect(rec.agentNickname).toBe('Sagan');
      expect(rec.agentRole).toBe('git-master');
      expect(rec.modelProvider).toBe('openai');
    }
  });

  it('parses session_meta with subagent source', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:12.884Z',
      type: 'session_meta',
      payload: {
        id: 'abc-123',
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: 'parent-session-id',
              agent_nickname: 'SubAgent',
              agent_role: 'executor',
              depth: 1,
            },
          },
        },
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    if (rec.kind === 'session_meta') {
      expect(rec.parentThreadId).toBe('parent-session-id');
      expect(rec.agentNickname).toBe('SubAgent');
    }
  });

  it('parses turn_context with model', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:12.886Z',
      type: 'turn_context',
      payload: {
        turn_id: 'turn-001',
        cwd: '/Users/test',
        model: 'gpt-5.4',
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('turn_context');
    if (rec.kind === 'turn_context') {
      expect(rec.turnId).toBe('turn-001');
      expect(rec.model).toBe('gpt-5.4');
    }
  });

  it('parses event_msg/user_message', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:12.887Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Hello!' },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('user_message');
    if (rec.kind === 'user_message') {
      expect(rec.message).toBe('Hello!');
    }
  });

  it('parses event_msg/task_started', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:12.888Z',
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: 'turn-001',
        model_context_window: 258400,
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('task_started');
    if (rec.kind === 'task_started') {
      expect(rec.turnId).toBe('turn-001');
      expect(rec.modelContextWindow).toBe(258400);
    }
  });

  it('parses event_msg/task_complete', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:15.100Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-001' },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('task_complete');
  });

  it('parses event_msg/token_count with absolute values', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:15.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 2000,
            output_tokens: 300,
            total_tokens: 5300,
          },
          last_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 2000,
            output_tokens: 300,
          },
        },
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('token_count');
    if (rec.kind === 'token_count') {
      expect(rec.totalInputTokens).toBe(5000);
      expect(rec.totalCachedInputTokens).toBe(2000);
      expect(rec.totalOutputTokens).toBe(300);
      expect(rec.totalTokens).toBe(5300);
    }
  });

  it('parses response_item/function_call', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:13.100Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"ls -la"}',
        call_id: 'call_abc123',
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('function_call');
    if (rec.kind === 'function_call') {
      expect(rec.name).toBe('exec_command');
      expect(rec.callId).toBe('call_abc123');
      expect(rec.arguments).toBe('{"cmd":"ls -la"}');
    }
  });

  it('parses response_item/function_call_output', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:14.200Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call_abc123',
        output: 'file1.txt\nfile2.txt',
      },
    });

    const records = parseLine(line);
    expect(records).toHaveLength(1);
    const rec = records[0];
    expect(rec.kind).toBe('function_call_output');
    if (rec.kind === 'function_call_output') {
      expect(rec.callId).toBe('call_abc123');
      expect(rec.output).toBe('file1.txt\nfile2.txt');
    }
  });

  it('ignores compacted lines', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:17.200Z',
      type: 'compacted',
      payload: { message: '', replacement_history: [] },
    });
    expect(parseLine(line)).toHaveLength(0);
  });

  it('ignores response_item/reasoning', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-07T00:33:17.300Z',
      type: 'response_item',
      payload: { type: 'reasoning', content: 'thinking...' },
    });
    expect(parseLine(line)).toHaveLength(0);
  });

  it('ignores invalid JSON lines gracefully', () => {
    expect(parseLine('not json at all')).toHaveLength(0);
    expect(parseLine('{')).toHaveLength(0);
    expect(parseLine('')).toHaveLength(0);
  });

  it('parses full fixture file', () => {
    const records = parseLines(FIXTURE_TEXT);
    expect(records.length).toBeGreaterThan(0);

    const kinds = records.map((r) => r.kind);
    expect(kinds).toContain('session_meta');
    expect(kinds).toContain('turn_context');
    expect(kinds).toContain('user_message');
    expect(kinds).toContain('task_started');
    expect(kinds).toContain('task_complete');
    expect(kinds).toContain('token_count');
    expect(kinds).toContain('function_call');
    expect(kinds).toContain('function_call_output');
  });
});

describe('Codex Normalizer', () => {
  it('buildAgentId extracts prefix from UUID', () => {
    expect(buildAgentId('019cc3c8-09e1-7782-ba7a-5be9e059261f')).toBe('cdx-019cc3c8');
  });

  it('buildAgentId strips hyphens before prefix', () => {
    // UUID without hyphens prefix uses first 8 chars of cleaned ID
    expect(buildAgentId('abcd-ef01-2345-6789-abcdef012345')).toBe('cdx-abcdef01');
  });

  it('session_meta → session.start', () => {
    const ctx = createContext('019cc3c8-09e1-7782-ba7a-5be9e059261f');
    const events = normalize(
      {
        kind: 'session_meta',
        id: '019cc3c8-09e1-7782-ba7a-5be9e059261f',
        timestamp: '2026-03-07T00:33:12.884Z',
        cwd: '/Users/test/project',
        originator: 'codex_cli_rs',
        modelProvider: 'openai',
      },
      ctx,
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session.start');
    expect(events[0].source).toBe('codex');
    expect(events[0].agent_id).toBe('cdx-019cc3c8');
    expect(events[0].project_id).toBe('/Users/test/project');
  });

  it('second session_meta is ignored (dedup)', () => {
    const ctx = createContext('019cc3c8-09e1-7782-ba7a-5be9e059261f');
    const meta = {
      kind: 'session_meta' as const,
      id: '019cc3c8-09e1-7782-ba7a-5be9e059261f',
      timestamp: '2026-03-07T00:33:12.884Z',
    };
    const first = normalize(meta, ctx);
    const second = normalize(meta, ctx);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('turn_context updates modelId in context', () => {
    const ctx = createContext('sid-001');
    normalize({ kind: 'turn_context', turnId: 't1', model: 'gpt-5.4', timestamp: '2026-03-07T00:00:00.000Z' }, ctx);
    expect(ctx.modelId).toBe('gpt-5.4');
  });

  it('turn_context emits no events', () => {
    const ctx = createContext('sid-001');
    const events = normalize(
      { kind: 'turn_context', turnId: 't1', model: 'gpt-5.4', timestamp: '2026-03-07T00:00:00.000Z' },
      ctx,
    );
    expect(events).toHaveLength(0);
  });

  it('task_started → agent.status: thinking', () => {
    const ctx = createContext('sid-001');
    const events = normalize(
      { kind: 'task_started', turnId: 'turn-001', modelContextWindow: 258400, timestamp: '2026-03-07T00:00:00.000Z' },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.status');
    expect((events[0].data as Record<string, unknown>).status).toBe('thinking');
  });

  it('task_complete → agent.status: idle', () => {
    const ctx = createContext('sid-001');
    const events = normalize(
      { kind: 'task_complete', turnId: 'turn-001', timestamp: '2026-03-07T00:00:00.000Z' },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent.status');
    expect((events[0].data as Record<string, unknown>).status).toBe('idle');
  });

  it('user_message → user.input', () => {
    const ctx = createContext('sid-001');
    const events = normalize(
      { kind: 'user_message', message: 'Hello!', timestamp: '2026-03-07T00:00:00.000Z' },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('user.input');
    expect((events[0].data as Record<string, unknown>).text_length).toBe(6);
  });

  it('agent_message → no events', () => {
    const ctx = createContext('sid-001');
    const events = normalize(
      { kind: 'agent_message', message: 'commentary', phase: 'commentary', timestamp: '2026-03-07T00:00:00.000Z' },
      ctx,
    );
    expect(events).toHaveLength(0);
  });

  it('function_call → tool.start', () => {
    const ctx = createContext('sid-001');
    const events = normalize(
      {
        kind: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"ls -la","workdir":"/tmp"}',
        callId: 'call_abc123',
        timestamp: '2026-03-07T00:00:00.000Z',
      },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool.start');
    expect(events[0].span_id).toBe('call_abc123');
    expect((events[0].data as Record<string, unknown>).tool_name).toBe('exec_command');
    // cmd 키가 input_summary로 추출되어야 함
    expect((events[0].data as Record<string, unknown>).input_summary).toBe('ls -la');
  });

  it('function_call_output → tool.end with duration', () => {
    const ctx = createContext('sid-001');
    // tool.start 먼저 발행
    normalize(
      {
        kind: 'function_call',
        name: 'exec_command',
        arguments: '{}',
        callId: 'call_abc123',
        timestamp: '2026-03-07T00:00:00.000Z',
      },
      ctx,
    );

    const events = normalize(
      {
        kind: 'function_call_output',
        callId: 'call_abc123',
        output: 'result here',
        timestamp: '2026-03-07T00:00:01.500Z',
      },
      ctx,
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool.end');
    expect(events[0].span_id).toBe('call_abc123');
    expect((events[0].data as Record<string, unknown>).duration_ms).toBe(1500);
    expect((events[0].data as Record<string, unknown>).response_length).toBe(11);
    // call_id가 activeToolTimestamps에서 제거되었는지 확인
    expect(ctx.activeToolTimestamps.has('call_abc123')).toBe(false);
  });

  it('token_count → metrics.usage with delta calculation', () => {
    const ctx = createContext('sid-001');

    // 첫 번째 token_count (초기: 0 → 5300)
    const first = normalize(
      {
        kind: 'token_count',
        totalInputTokens: 5000,
        totalCachedInputTokens: 2000,
        totalOutputTokens: 300,
        totalTokens: 5300,
        timestamp: '2026-03-07T00:00:00.000Z',
      },
      ctx,
    );
    expect(first).toHaveLength(1);
    expect(first[0].type).toBe('metrics.usage');
    expect((first[0].data as Record<string, unknown>).tokens).toBe(5300);
    expect((first[0].data as Record<string, unknown>).input_tokens).toBe(5000);
    expect((first[0].data as Record<string, unknown>).output_tokens).toBe(300);

    // 두 번째 token_count (delta: 5300 → 9600 = 4300)
    const second = normalize(
      {
        kind: 'token_count',
        totalInputTokens: 9000,
        totalCachedInputTokens: 4000,
        totalOutputTokens: 600,
        totalTokens: 9600,
        timestamp: '2026-03-07T00:00:05.000Z',
      },
      ctx,
    );
    expect(second).toHaveLength(1);
    expect((second[0].data as Record<string, unknown>).tokens).toBe(4300);
    expect((second[0].data as Record<string, unknown>).input_tokens).toBe(4000);
    expect((second[0].data as Record<string, unknown>).output_tokens).toBe(300);
  });

  it('duplicate token_count (delta=0) → no events', () => {
    const ctx = createContext('sid-001');
    const tokenRecord = {
      kind: 'token_count' as const,
      totalInputTokens: 5000,
      totalCachedInputTokens: 2000,
      totalOutputTokens: 300,
      totalTokens: 5300,
      timestamp: '2026-03-07T00:00:00.000Z',
    };
    normalize(tokenRecord, ctx);
    const second = normalize(tokenRecord, ctx);
    expect(second).toHaveLength(0);
  });

  it('normalizes complete fixture file', () => {
    const records = parseLines(FIXTURE_TEXT);
    const sessionId = '019cc3c8-09e1-7782-ba7a-5be9e059261f';
    const ctx = createContext(sessionId);
    const events = normalizeAll(records, ctx);

    expect(events.length).toBeGreaterThan(0);

    const types = events.map((e) => e.type);
    expect(types).toContain('session.start');
    expect(types).toContain('user.input');
    expect(types).toContain('agent.status');
    expect(types).toContain('tool.start');
    expect(types).toContain('tool.end');
    expect(types).toContain('metrics.usage');

    // 모든 이벤트가 올바른 agent_id를 가져야 함
    for (const event of events) {
      expect(event.agent_id).toBe('cdx-019cc3c8');
      expect(event.source).toBe('codex');
    }

    // 모델 ID가 turn_context에서 전파되어야 함
    const toolStart = events.find((e) => e.type === 'tool.start');
    expect(toolStart?.model_id).toBe('gpt-5.4');
  });

  it('sequential seq numbers', () => {
    const ctx = createContext('sid-001');
    const records = parseLines(FIXTURE_TEXT);
    const events = normalizeAll(records, ctx);
    for (let i = 0; i < events.length; i++) {
      expect(events[i].seq).toBe(i + 1);
    }
  });
});
