/**
 * E2E 테스트 헬퍼 — 백엔드 HTTP Collector를 통해 이벤트 주입
 */

import { randomUUID } from 'crypto';

export const API_BASE = 'http://localhost:3001';

export interface EventPayload {
  type: string;
  agent_id: string;
  session_id: string;
  source?: string;
  agent_name?: string;
  /** tool.start / tool.end 매칭에 사용 — StateManager는 span_id로 tool을 추적 */
  span_id?: string;
  data?: Record<string, unknown>;
}

export async function injectEvent(payload: EventPayload): Promise<void> {
  const body = {
    ts: new Date().toISOString(),
    event_id: `evt-e2e-${randomUUID()}`,
    source: 'claude_code',
    ...payload,
  };

  const res = await fetch(`${API_BASE}/api/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Event injection failed: HTTP ${res.status} — ${await res.text()}`);
  }
}

/** agent 세션 전체 시나리오 주입: session.start → tool.start → tool.end → session.end */
export async function injectAgentSession(opts: {
  agentId: string;
  agentName: string;
  sessionId: string;
  toolName?: string;
}): Promise<void> {
  const { agentId, agentName, sessionId, toolName = 'Read' } = opts;
  const toolUseId = `tuid-${randomUUID()}`;

  await injectEvent({
    type: 'session.start',
    agent_id: agentId,
    agent_name: agentName,
    session_id: sessionId,
    data: {},
  });

  await injectEvent({
    type: 'tool.start',
    agent_id: agentId,
    session_id: sessionId,
    span_id: toolUseId,
    data: { tool_name: toolName, tool_use_id: toolUseId },
  });

  await injectEvent({
    type: 'tool.end',
    agent_id: agentId,
    session_id: sessionId,
    span_id: toolUseId,
    data: { tool_use_id: toolUseId },
  });

  await injectEvent({
    type: 'session.end',
    agent_id: agentId,
    session_id: sessionId,
    data: {},
  });
}

/** 고유한 테스트 ID 생성 — 병렬 실행 시 충돌 방지 */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
}
