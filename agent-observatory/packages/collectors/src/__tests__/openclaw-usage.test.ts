/**
 * OpenClaw 파서/노멀라이저 — 모델 ID + 토큰 사용량 + 어시스턴트 텍스트 응답 테스트.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseLine, parseLines } from '../openclaw/parser.js';
import type { OCAssistantMessage, OCSessionHeader, OCToolCall } from '../openclaw/parser.js';
import { normalize, normalizeAll, createContext } from '../openclaw/normalizer.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// ── Parser 테스트 ──────────────────────────────────────────────────────────────

describe('OpenClaw Parser — 새 기능', () => {
  describe('session header에서 model 파싱', () => {
    it('model 필드가 있는 session header를 파싱해야 한다', () => {
      const line = JSON.stringify({
        type: 'session',
        version: 7,
        id: 'sess-model-01',
        cwd: '/home/user',
        model: 'claude-sonnet-4-6',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(1);
      const header = records[0] as OCSessionHeader;
      expect(header.kind).toBe('session_header');
      expect(header.model).toBe('claude-sonnet-4-6');
    });

    it('model 필드가 없는 session header는 model이 undefined여야 한다', () => {
      const line = JSON.stringify({ type: 'session', version: 7, id: 'sess-no-model' });
      const records = parseLine(line);
      const header = records[0] as OCSessionHeader;
      expect(header.model).toBeUndefined();
    });
  });

  describe('어시스턴트 텍스트 응답 (assistant_message) 파싱', () => {
    it('텍스트만 있는 어시스턴트 응답을 파싱해야 한다', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Paris is the capital of France.' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 25, output_tokens: 10 },
        },
        timestamp: '2026-02-27T14:00:02.000Z',
      });

      const records = parseLine(line);
      // 텍스트 + 사용량 → assistant_message 1개
      expect(records).toHaveLength(1);
      const msg = records[0] as OCAssistantMessage;
      expect(msg.kind).toBe('assistant_message');
      expect(msg.textLength).toBe(31); // 'Paris is the capital of France.' = 31자
      expect(msg.model).toBe('claude-sonnet-4-6');
      expect(msg.usage?.input_tokens).toBe(25);
      expect(msg.usage?.output_tokens).toBe(10);
    });

    it('도구 호출과 텍스트가 함께 있으면 tool_call + assistant_message를 반환해야 한다', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'tc1', name: 'Read', input: { file_path: '/x.ts' } },
            { type: 'text', text: 'Sure, reading now.' },
          ],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 50, output_tokens: 15 },
        },
        timestamp: '2026-02-27T14:00:04.000Z',
      });

      const records = parseLine(line);
      expect(records).toHaveLength(2);

      const toolCall = records.find((r) => r.kind === 'tool_call') as OCToolCall;
      const assistantMsg = records.find((r) => r.kind === 'assistant_message') as OCAssistantMessage;

      expect(toolCall).toBeDefined();
      expect(toolCall.name).toBe('Read');

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.textLength).toBe(18); // 'Sure, reading now.' = 18자
      expect(assistantMsg.usage?.input_tokens).toBe(50);
    });

    it('텍스트도 사용량도 모델도 없는 assistant 메시지는 빈 배열을 반환해야 한다', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [], // 비어있음
        },
      });

      const records = parseLine(line);
      expect(records).toHaveLength(0);
    });

    it('사용량만 있고 텍스트 없는 assistant 메시지도 assistant_message를 반환해야 한다', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tc1', name: 'Bash', input: {} }],
          usage: { input_tokens: 100, output_tokens: 0 },
        },
      });

      const records = parseLine(line);
      const toolCalls = records.filter((r) => r.kind === 'tool_call');
      const assistantMsgs = records.filter((r) => r.kind === 'assistant_message');
      expect(toolCalls).toHaveLength(1);
      expect(assistantMsgs).toHaveLength(1);
      expect((assistantMsgs[0] as OCAssistantMessage).textLength).toBe(0);
      expect((assistantMsgs[0] as OCAssistantMessage).usage?.input_tokens).toBe(100);
    });

    it('cache 토큰 정보를 파싱해야 한다', () => {
      const line = JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done.' }],
          usage: {
            input_tokens: 50,
            output_tokens: 5,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 30,
          },
        },
      });

      const records = parseLine(line);
      const msg = records[0] as OCAssistantMessage;
      expect(msg.usage?.cache_creation_input_tokens).toBe(10);
      expect(msg.usage?.cache_read_input_tokens).toBe(30);
    });
  });

  describe('openclaw-with-usage.jsonl fixture 파싱', () => {
    it('session header에서 model을 추출해야 한다', () => {
      const content = readFileSync(resolve(FIXTURES, 'openclaw-with-usage.jsonl'), 'utf-8');
      const records = parseLines(content);

      const header = records.find((r) => r.kind === 'session_header') as OCSessionHeader;
      expect(header.model).toBe('claude-sonnet-4-6');
    });

    it('assistant_message 레코드 3개가 있어야 한다', () => {
      const content = readFileSync(resolve(FIXTURES, 'openclaw-with-usage.jsonl'), 'utf-8');
      const records = parseLines(content);

      const assistantMsgs = records.filter((r) => r.kind === 'assistant_message');
      expect(assistantMsgs).toHaveLength(3); // m2, m4, m6
    });

    it('마지막 어시스턴트 메시지는 haiku 모델을 사용해야 한다', () => {
      const content = readFileSync(resolve(FIXTURES, 'openclaw-with-usage.jsonl'), 'utf-8');
      const records = parseLines(content);

      const assistantMsgs = records.filter((r) => r.kind === 'assistant_message') as OCAssistantMessage[];
      const lastMsg = assistantMsgs[assistantMsgs.length - 1]!;
      expect(lastMsg.model).toBe('claude-haiku-4-5');
    });
  });
});

// ── Normalizer 테스트 ──────────────────────────────────────────────────────────

describe('OpenClaw Normalizer — 새 기능', () => {
  describe('assistant_message → events 변환', () => {
    it('텍스트 응답이 있으면 llm.end 이벤트를 발행해야 한다', () => {
      const ctx = createContext('agent-x', 'sess-x');
      const record: OCAssistantMessage = {
        kind: 'assistant_message',
        textLength: 30,
        model: 'claude-sonnet-4-6',
        timestamp: '2026-02-27T14:00:02.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('llm.end');
      expect(events[0].data?.text_length).toBe(30);
      expect(events[0].data?.model_id).toBe('claude-sonnet-4-6');
    });

    it('사용량 데이터가 있으면 metrics.usage 이벤트를 발행해야 한다', () => {
      const ctx = createContext('agent-x', 'sess-x');
      const record: OCAssistantMessage = {
        kind: 'assistant_message',
        textLength: 0,
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 50 },
        timestamp: '2026-02-27T14:00:02.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(1);
      const usageEvent = events[0]!;
      expect(usageEvent.type).toBe('metrics.usage');
      expect(usageEvent.data?.input_tokens).toBe(100);
      expect(usageEvent.data?.output_tokens).toBe(50);
      expect(usageEvent.data?.tokens).toBe(150);
    });

    it('텍스트와 사용량 모두 있으면 llm.end + metrics.usage 2개 이벤트가 발행되어야 한다', () => {
      const ctx = createContext('agent-x', 'sess-x');
      const record: OCAssistantMessage = {
        kind: 'assistant_message',
        textLength: 25,
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 50, output_tokens: 20 },
        timestamp: '2026-02-27T14:00:02.000Z',
      };

      const events = normalize(record, ctx);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('llm.end');
      expect(events[1].type).toBe('metrics.usage');
    });

    it('캐시 토큰 정보가 metrics.usage에 포함되어야 한다', () => {
      const ctx = createContext('agent-x', 'sess-x');
      const record: OCAssistantMessage = {
        kind: 'assistant_message',
        textLength: 5,
        usage: {
          input_tokens: 50,
          output_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 100,
        },
        timestamp: '2026-02-27T14:00:02.000Z',
      };

      const events = normalize(record, ctx);
      const usageEvent = events.find((e) => e.type === 'metrics.usage')!;
      expect(usageEvent.data?.cache_creation_input_tokens).toBe(20);
      expect(usageEvent.data?.cache_read_input_tokens).toBe(100);
    });

    it('assistant_message에서 model_id가 context에 저장되어 이후 이벤트에 전파되어야 한다', () => {
      const ctx = createContext('agent-x', 'sess-x');
      expect(ctx.modelId).toBeUndefined();

      const assistantRecord: OCAssistantMessage = {
        kind: 'assistant_message',
        textLength: 10,
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 10, output_tokens: 5 },
        timestamp: '2026-02-27T14:00:02.000Z',
      };

      normalize(assistantRecord, ctx);
      expect(ctx.modelId).toBe('claude-haiku-4-5');

      // 이후 이벤트에 model_id가 포함되어야 함
      const userInput = {
        kind: 'user_input' as const,
        text: 'Next question',
        timestamp: '2026-02-27T14:00:03.000Z',
      };
      const userEvents = normalize(userInput, ctx);
      expect(userEvents[0].model_id).toBe('claude-haiku-4-5');
    });
  });

  describe('session header에서 model_id 추출', () => {
    it('session header의 model이 context.modelId에 저장되어야 한다', () => {
      const ctx = createContext('agent-y', 'sess-y');
      const record = {
        kind: 'session_header' as const,
        version: 7,
        sessionId: 'sess-model-test',
        cwd: '/home/user',
        model: 'claude-opus-4-6',
        timestamp: '2026-02-27T14:00:00.000Z',
      };

      const events = normalize(record, ctx);
      expect(ctx.modelId).toBe('claude-opus-4-6');
      // session.start 이벤트에도 model_id가 포함되어야 함
      expect(events[0].model_id).toBe('claude-opus-4-6');
    });
  });

  describe('openclaw-with-usage.jsonl 전체 정규화', () => {
    it('llm.end와 metrics.usage 이벤트가 포함되어야 한다', () => {
      const content = readFileSync(resolve(FIXTURES, 'openclaw-with-usage.jsonl'), 'utf-8');
      const records = parseLines(content);
      const ctx = createContext('usage-agent', '');
      const events = normalizeAll(records, ctx);

      const llmEndEvents = events.filter((e) => e.type === 'llm.end');
      const usageEvents = events.filter((e) => e.type === 'metrics.usage');

      // 3개 어시스턴트 메시지 → 3x llm.end + 3x metrics.usage
      expect(llmEndEvents).toHaveLength(3);
      expect(usageEvents).toHaveLength(3);

      // 총 토큰 확인: 25+10=35, 50+15=65, 80+12=92 → 합계 192
      const totalTokens = usageEvents.reduce(
        (sum, e) => sum + ((e.data?.tokens as number) ?? 0),
        0,
      );
      expect(totalTokens).toBe(192);
    });

    it('session header model이 이후 이벤트에 전파되어야 한다', () => {
      const content = readFileSync(resolve(FIXTURES, 'openclaw-with-usage.jsonl'), 'utf-8');
      const records = parseLines(content);
      const ctx = createContext('usage-agent', '');
      const events = normalizeAll(records, ctx);

      // session.start는 model_id를 가져야 함
      const sessionStart = events.find((e) => e.type === 'session.start');
      expect(sessionStart?.model_id).toBe('claude-sonnet-4-6');
    });

    it('마지막 어시스턴트 응답 후 context.modelId가 haiku로 바뀌어야 한다', () => {
      const content = readFileSync(resolve(FIXTURES, 'openclaw-with-usage.jsonl'), 'utf-8');
      const records = parseLines(content);
      const ctx = createContext('usage-agent', '');
      normalizeAll(records, ctx);

      // 마지막 메시지가 haiku이므로 context도 haiku여야 함
      expect(ctx.modelId).toBe('claude-haiku-4-5');
    });
  });
});
