/**
 * Claude Code Hooks 엔드포인트 테스트.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { InMemoryEventBus } from '../core/event-bus.js';
import { createHooksRouter } from '../delivery/hooks.js';
import type { UAEPEvent } from '@agent-observatory/shared';

function createApp() {
  const eventBus = new InMemoryEventBus();
  const receivedEvents: UAEPEvent[] = [];
  eventBus.subscribe((e) => receivedEvents.push(e));

  const app = express();
  app.use(express.json());
  app.use(createHooksRouter(eventBus));

  return { app, receivedEvents };
}

describe('Claude Code Hooks Endpoint', () => {
  let app: ReturnType<typeof express>;
  let receivedEvents: UAEPEvent[];

  beforeEach(() => {
    const ctx = createApp();
    app = ctx.app;
    receivedEvents = ctx.receivedEvents;
  });

  // ── SessionStart ────────────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - SessionStart', () => {
    it('should accept SessionStart with transcript_path and emit session.start', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-sonnet-4-6',
        source: 'claude_code',
        transcript_path: '/Users/joy/.claude/projects/-Users-joy-proj/abc12345.jsonl',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(res.body.session_id).toBe('abc12345');

      expect(receivedEvents).toHaveLength(1);
      const event = receivedEvents[0]!;
      expect(event.type).toBe('session.start');
      expect(event.model_id).toBe('claude-sonnet-4-6');
      expect(event.session_id).toBe('abc12345');
      expect(event.agent_id).toBe('cc-abc12345');
      expect(event.source).toBe('claude_code');
    });

    it('should accept SessionStart with explicit session_id', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-opus-4-6',
        session_id: 'explicit-session-001',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(receivedEvents).toHaveLength(1);
      const event = receivedEvents[0]!;
      expect(event.model_id).toBe('claude-opus-4-6');
      expect(event.session_id).toBe('explicit-session-001');
    });

    it('should return 400 if session_id cannot be determined', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-sonnet-4-6',
        // transcript_path와 session_id 모두 없음
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(400);

      expect(receivedEvents).toHaveLength(0);
    });

    it('should include model_id in event.data as well', async () => {
      const payload = {
        type: 'SessionStart',
        model: 'claude-haiku-4-5',
        session_id: 'haiku-session',
        agent_type: 'subagent',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      const event = receivedEvents[0]!;
      expect(event.data?.['model_id']).toBe('claude-haiku-4-5');
      expect(event.data?.['agent_type']).toBe('subagent');
      expect(event.data?.['from_hook']).toBe(true);
    });
  });

  // ── SessionStop / Stop ──────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - SessionStop / Stop', () => {
    it('should accept SessionStop and emit session.end', async () => {
      const payload = {
        type: 'SessionStop',
        transcript_path: '/path/to/stopabc1.jsonl',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]!.type).toBe('session.end');
    });

    it('should accept Stop (alternative name) and emit session.end', async () => {
      const payload = {
        type: 'Stop',
        session_id: 'stop-session-99',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(receivedEvents[0]!.type).toBe('session.end');
    });

    it('should include last_assistant_message_length in session.end data', async () => {
      const payload = {
        type: 'Stop',
        session_id: 'session-with-msg',
        last_assistant_message: 'Hello world, this is the final response.',
        stop_hook_active: false,
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('session.end');
      expect(event.data?.['last_assistant_message_length']).toBe(40);
      expect(event.data?.['stop_hook_active']).toBe(false);
    });

    it('should silently accept SessionStop without session_id', async () => {
      const payload = { type: 'SessionStop' };
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      // session_id 없으면 이벤트 발행 안 함
      expect(receivedEvents).toHaveLength(0);
    });
  });

  // ── PostToolUse ─────────────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - PostToolUse', () => {
    it('should emit tool.end with tool metadata', async () => {
      const payload = {
        type: 'PostToolUse',
        session_id: 'tool-session-01',
        tool_name: 'Read',
        tool_use_id: 'toolu_abc123',
        tool_input: { file_path: '/secret/path/file.txt', encoding: 'utf-8' },
        tool_response: 'file contents here...',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(1);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('tool.end');
      expect(event.session_id).toBe('tool-session-01');
      expect(event.data?.['tool_name']).toBe('Read');
      expect(event.data?.['tool_use_id']).toBe('toolu_abc123');
      // 개인정보 보호: 키 이름만 기록, 실제 값 없음
      expect(event.data?.['input_keys']).toEqual(['file_path', 'encoding']);
      // 응답 길이만 기록
      expect(event.data?.['response_length']).toBe(21);
      expect(event.data?.['from_hook']).toBe(true);
    });

    it('should handle PostToolUse without tool_input and tool_response', async () => {
      const payload = {
        type: 'PostToolUse',
        session_id: 'tool-session-02',
        tool_name: 'Bash',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('tool.end');
      expect(event.data?.['input_keys']).toEqual([]);
      expect(event.data?.['response_length']).toBe(0);
    });

    it('should silently accept PostToolUse without session_id', async () => {
      const payload = {
        type: 'PostToolUse',
        tool_name: 'Read',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(receivedEvents).toHaveLength(0);
    });
  });

  // ── PostToolUseFailure ──────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - PostToolUseFailure', () => {
    it('should emit tool.error with error details', async () => {
      const payload = {
        type: 'PostToolUseFailure',
        session_id: 'err-session-01',
        tool_name: 'Bash',
        tool_use_id: 'toolu_fail001',
        tool_input: { command: 'rm -rf /' },
        error: 'Permission denied',
        is_interrupt: false,
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(1);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('tool.error');
      expect(event.session_id).toBe('err-session-01');
      expect(event.data?.['tool_name']).toBe('Bash');
      expect(event.data?.['tool_use_id']).toBe('toolu_fail001');
      expect(event.data?.['input_keys']).toEqual(['command']);
      expect(event.data?.['error']).toBe('Permission denied');
      expect(event.data?.['is_interrupt']).toBe(false);
      expect(event.data?.['from_hook']).toBe(true);
    });

    it('should mark is_interrupt=true when user interrupts tool', async () => {
      const payload = {
        type: 'PostToolUseFailure',
        session_id: 'err-session-02',
        tool_name: 'Bash',
        error: 'Interrupted by user',
        is_interrupt: true,
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('tool.error');
      expect(event.data?.['is_interrupt']).toBe(true);
    });

    it('should silently accept PostToolUseFailure without session_id', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ type: 'PostToolUseFailure', tool_name: 'Read' })
        .expect(200);

      expect(receivedEvents).toHaveLength(0);
    });
  });

  // ── SubagentStart ───────────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - SubagentStart', () => {
    it('should emit subagent.spawn with child agent info', async () => {
      const payload = {
        type: 'SubagentStart',
        session_id: 'parent-session-abc',
        agent_id: 'child-session-xyz',
        agent_type: 'general-purpose',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(1);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('subagent.spawn');
      expect(event.session_id).toBe('parent-session-abc');
      expect(event.agent_id).toBe('cc-parent-s');  // 'parent-session-abc'.slice(0,8) = 'parent-s'
      expect(event.data?.['child_agent_id']).toBe('child-session-xyz');
      expect(event.data?.['agent_type']).toBe('general-purpose');
      expect(event.data?.['from_hook']).toBe(true);
    });

    it('should accept SubagentStart via transcript_path', async () => {
      const payload = {
        type: 'SubagentStart',
        transcript_path: '/path/to/parent12.jsonl',
        agent_id: 'child-001',
      };

      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('subagent.spawn');
      expect(event.session_id).toBe('parent12');
    });

    it('should silently accept SubagentStart without parent session_id', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ type: 'SubagentStart', agent_id: 'orphan-child' })
        .expect(200);

      expect(receivedEvents).toHaveLength(0);
    });
  });

  // ── SubagentStop ────────────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - SubagentStop', () => {
    it('should emit subagent.end with child completion info', async () => {
      const payload = {
        type: 'SubagentStop',
        session_id: 'parent-session-abc',
        agent_id: 'child-session-xyz',
        agent_type: 'general-purpose',
        agent_transcript_path: '/path/to/child-session-xyz.jsonl',
        last_assistant_message: 'Task completed successfully.',
      };

      const res = await request(app)
        .post('/api/v1/hooks/claude-code')
        .send(payload)
        .expect(200);

      expect(res.body.status).toBe('accepted');
      expect(receivedEvents).toHaveLength(1);

      const event = receivedEvents[0]!;
      expect(event.type).toBe('subagent.end');
      expect(event.session_id).toBe('parent-session-abc');
      expect(event.data?.['child_agent_id']).toBe('child-session-xyz');
      expect(event.data?.['child_session_id']).toBe('child-session-xyz');
      expect(event.data?.['agent_type']).toBe('general-purpose');
      expect(event.data?.['last_assistant_message_length']).toBe(28); // 'Task completed successfully.' = 28자
      expect(event.data?.['from_hook']).toBe(true);
    });

    it('should silently accept SubagentStop without parent session_id', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ type: 'SubagentStop', agent_id: 'child-001' })
        .expect(200);

      expect(receivedEvents).toHaveLength(0);
    });
  });

  // ── Invalid payload ─────────────────────────────────────────────────────────

  describe('POST /api/v1/hooks/claude-code - invalid payload', () => {
    it('should return 400 for missing type', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ model: 'test' })
        .expect(400);
    });

    it('should return 400 for empty body', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({})
        .expect(400);
    });

    it('should accept unknown hook types silently', async () => {
      await request(app)
        .post('/api/v1/hooks/claude-code')
        .send({ type: 'FutureHookType', data: 'something' })
        .expect(200);
    });
  });
});
