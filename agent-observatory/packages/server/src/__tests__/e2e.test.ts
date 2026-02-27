/**
 * E2E Integration Test
 *
 * Full pipeline: JSONL fixture → Collector parser/normalizer → EventBus → StateManager → REST API + WebSocket
 *
 * This test uses actual collector parsers with real JSONL fixtures
 * to verify the entire data flow works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import type { UAEPEvent } from '@agent-observatory/shared';
import { generateEventId } from '@agent-observatory/shared';

// Collector parsers and normalizers
import {
  parseLines as parseCCLines,
} from '@agent-observatory/collectors/claude-code/parser';
import {
  createContext as createCCContext,
  normalizeAll as normalizeCCAll,
} from '@agent-observatory/collectors/claude-code/normalizer';
import {
  parseLines as parseOCLines,
} from '@agent-observatory/collectors/openclaw/parser';
import {
  createContext as createOCContext,
  normalizeAll as normalizeOCAll,
} from '@agent-observatory/collectors/openclaw/normalizer';

const FIXTURES_DIR = resolve(
  import.meta.dirname,
  '../../../collectors/src/__tests__/fixtures',
);

function waitFor<T>(socket: ClientSocket, event: string, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * CC normalizer는 JSONL 내용만 변환하고 session.start는 생성하지 않는다.
 * 실제 ClaudeCodeCollector에서는 watcher가 새 파일 발견 시 session.start를 생성한다.
 * E2E 테스트에서는 이를 시뮬레이션한다.
 */
function makeSessionStartEvent(
  agentId: string,
  agentName: string,
  sessionId: string,
  source: UAEPEvent['source'] = 'claude_code',
): UAEPEvent {
  return {
    ts: new Date().toISOString(),
    event_id: generateEventId(),
    source,
    agent_id: agentId,
    agent_name: agentName,
    session_id: sessionId,
    type: 'session.start',
  };
}

describe('E2E: JSONL → Collector → Server → API/WebSocket', () => {
  let instance: AppInstance;
  let port: number;

  beforeEach(async () => {
    instance = createApp();
    await new Promise<void>((resolve) => {
      instance.server.listen(0, () => {
        const addr = instance.server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      instance.io.close(() => resolve());
    });
  });

  describe('Claude Code JSONL → Server', () => {
    it('should process CC fixture and populate agent state + history', async () => {
      // 1. Parse JSONL fixture
      const jsonl = readFileSync(resolve(FIXTURES_DIR, 'claude-code-sample.jsonl'), 'utf-8');
      const records = parseCCLines(jsonl);
      expect(records.length).toBeGreaterThan(0);

      // 2. Normalize to UAEP events
      const ctx = createCCContext('test-session-cc-001.jsonl');
      const events = normalizeCCAll(records, ctx);
      expect(events.length).toBeGreaterThan(0);

      // 3. Simulate collector: session.start first, then normalized events
      const sessionStart = makeSessionStartEvent(ctx.agentId, ctx.agentName, ctx.sessionId);
      instance.eventBus.publish(sessionStart);
      for (const event of events) {
        instance.eventBus.publish(event);
      }

      // 4. Verify via REST API: agent exists
      const agentsRes = await request(instance.app).get('/api/v1/agents');
      expect(agentsRes.status).toBe(200);
      expect(agentsRes.body.agents.length).toBeGreaterThanOrEqual(1);

      const ccAgent = agentsRes.body.agents.find(
        (a: { source: string }) => a.source === 'claude_code',
      );
      expect(ccAgent).toBeDefined();
      expect(ccAgent.total_tool_calls).toBeGreaterThan(0);

      // 5. Verify via REST API: events are stored in history
      const eventsRes = await request(instance.app).get(
        `/api/v1/agents/${ccAgent.agent_id}/events`,
      );
      expect(eventsRes.status).toBe(200);
      expect(eventsRes.body.events.length).toBeGreaterThan(0);

      // 6. Verify tool distribution is populated
      expect(ccAgent.tool_distribution).toBeDefined();
      const totalTools = Object.values(ccAgent.tool_distribution as Record<string, number>)
        .reduce((sum: number, v) => sum + (v as number), 0);
      expect(totalTools).toBeGreaterThan(0);
    });

    it('should reflect CC events in metrics', async () => {
      const jsonl = readFileSync(resolve(FIXTURES_DIR, 'claude-code-sample.jsonl'), 'utf-8');
      const records = parseCCLines(jsonl);
      const ctx = createCCContext('test-session-cc-002.jsonl');
      const events = normalizeCCAll(records, ctx);

      const sessionStart = makeSessionStartEvent(ctx.agentId, ctx.agentName, ctx.sessionId);
      instance.eventBus.publish(sessionStart);
      for (const event of events) {
        instance.eventBus.publish(event);
      }

      const metricsRes = await request(instance.app).get('/api/v1/metrics/summary');
      expect(metricsRes.status).toBe(200);
      expect(metricsRes.body.metrics.total_tool_calls_per_minute).toBeGreaterThan(0);
    });
  });

  describe('OpenClaw JSONL → Server', () => {
    it('should process OC fixture with tools and populate agent state', async () => {
      // OC normalizer generates session.start from session_header
      const jsonl = readFileSync(resolve(FIXTURES_DIR, 'openclaw-with-tools.jsonl'), 'utf-8');
      const records = parseOCLines(jsonl);
      expect(records.length).toBeGreaterThan(0);

      const ctx = createOCContext('oc-agent-test', 'oc-session-def456');
      const events = normalizeOCAll(records, ctx);
      expect(events.length).toBeGreaterThan(0);

      // session.start should be in events (from session_header)
      const hasSessionStart = events.some(e => e.type === 'session.start');
      expect(hasSessionStart).toBe(true);

      for (const event of events) {
        instance.eventBus.publish(event);
      }

      // Verify via REST API
      const agentsRes = await request(instance.app).get('/api/v1/agents');
      expect(agentsRes.status).toBe(200);

      const ocAgent = agentsRes.body.agents.find(
        (a: { source: string }) => a.source === 'openclaw',
      );
      expect(ocAgent).toBeDefined();
      expect(ocAgent.total_tool_calls).toBeGreaterThan(0);
    });
  });

  describe('Multi-source concurrent agents', () => {
    it('should handle CC + OC agents simultaneously', async () => {
      // CC events (with session.start)
      const ccJsonl = readFileSync(resolve(FIXTURES_DIR, 'claude-code-sample.jsonl'), 'utf-8');
      const ccRecords = parseCCLines(ccJsonl);
      const ccCtx = createCCContext('cc-multi-001.jsonl');
      const ccEvents = normalizeCCAll(ccRecords, ccCtx);

      // OC events (session.start comes from session_header)
      const ocJsonl = readFileSync(resolve(FIXTURES_DIR, 'openclaw-with-tools.jsonl'), 'utf-8');
      const ocRecords = parseOCLines(ocJsonl);
      const ocCtx = createOCContext('oc-multi-001', 'oc-multi-session');
      const ocEvents = normalizeOCAll(ocRecords, ocCtx);

      // Publish CC session.start first
      const ccSessionStart = makeSessionStartEvent(ccCtx.agentId, ccCtx.agentName, ccCtx.sessionId);
      instance.eventBus.publish(ccSessionStart);

      // Interleave all events (simulating concurrent reporting)
      const allEvents = [...ccEvents, ...ocEvents];
      for (const event of allEvents) {
        instance.eventBus.publish(event);
      }

      // Verify both agents exist
      const agentsRes = await request(instance.app).get('/api/v1/agents');
      expect(agentsRes.body.agents.length).toBeGreaterThanOrEqual(2);

      const sources = agentsRes.body.agents.map((a: { source: string }) => a.source);
      expect(sources).toContain('claude_code');
      expect(sources).toContain('openclaw');

      // Verify metrics reflect both sources
      const metricsRes = await request(instance.app).get('/api/v1/metrics/summary');
      const srcDist = metricsRes.body.metrics.source_distribution;
      expect(srcDist).toBeDefined();
    });
  });

  describe('Full pipeline with WebSocket', () => {
    it('should deliver CC events to dashboard WebSocket client', async () => {
      const client = ioc(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      try {
        // Wait for init
        const initData = await waitFor<{ agents: unknown[]; metrics: unknown }>(client, 'init');
        expect(initData.agents).toBeDefined();

        // Collect events and state changes
        const receivedEvents: Array<{ type: string }> = [];
        client.on('event', (evt: { type: string }) => {
          receivedEvents.push(evt);
        });

        // Parse and publish CC fixture with session.start
        const jsonl = readFileSync(resolve(FIXTURES_DIR, 'claude-code-sample.jsonl'), 'utf-8');
        const records = parseCCLines(jsonl);
        const ctx = createCCContext('ws-test-001.jsonl');
        const events = normalizeCCAll(records, ctx);

        const sessionStart = makeSessionStartEvent(ctx.agentId, ctx.agentName, ctx.sessionId);
        instance.eventBus.publish(sessionStart);
        for (const event of events) {
          instance.eventBus.publish(event);
        }

        // Wait for dashboard batch (1s interval + buffer)
        await new Promise((r) => setTimeout(r, 1500));

        // Dashboard client should receive all events (broadcast mode)
        expect(receivedEvents.length).toBeGreaterThan(0);

        // Verify agent exists via REST API too
        const agentsRes = await request(instance.app).get('/api/v1/agents');
        expect(agentsRes.body.agents.length).toBeGreaterThan(0);
      } finally {
        client.disconnect();
      }
    });
  });
});
