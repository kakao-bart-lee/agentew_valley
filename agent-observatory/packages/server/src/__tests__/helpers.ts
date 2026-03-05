import type { UAEPEvent, UAEPEventType, AgentSourceType } from '@agent-observatory/shared';

let seq = 0;

export function makeEvent(
  overrides: Partial<UAEPEvent> & { type: UAEPEventType },
): UAEPEvent {
  seq++;
  return {
    ts: new Date().toISOString(),
    event_id: `evt-${seq}-${Date.now()}`,
    source: 'claude_code' as AgentSourceType,
    agent_id: 'agent-1',
    session_id: 'session-1',
    ...overrides,
  };
}

export function makeSessionStart(
  agentId = 'agent-1',
  sessionId = 'session-1',
  overrides: Partial<UAEPEvent> = {},
): UAEPEvent {
  return makeEvent({
    type: 'session.start',
    agent_id: agentId,
    agent_name: agentId,
    session_id: sessionId,
    ...overrides,
  });
}

export function makeToolStart(
  toolName: string,
  agentId = 'agent-1',
  spanId?: string,
  overrides: Partial<UAEPEvent> = {},
): UAEPEvent {
  return makeEvent({
    type: 'tool.start',
    agent_id: agentId,
    span_id: spanId ?? `span-${seq}`,
    data: { tool_name: toolName },
    ...overrides,
  });
}

export function makeToolEnd(
  agentId = 'agent-1',
  spanId?: string,
  overrides: Partial<UAEPEvent> = {},
): UAEPEvent {
  return makeEvent({
    type: 'tool.end',
    agent_id: agentId,
    span_id: spanId,
    ...overrides,
  });
}

export function makeSessionEnd(
  agentId = 'agent-1',
  overrides: Partial<UAEPEvent> = {},
): UAEPEvent {
  return makeEvent({
    type: 'session.end',
    agent_id: agentId,
    ...overrides,
  });
}

export function makeMetricsUsage(
  tokens: number,
  cost: number,
  agentId = 'agent-1',
  overrides: Partial<UAEPEvent> = {},
): UAEPEvent {
  const overrideData = overrides.data ?? {};
  return makeEvent({
    type: 'metrics.usage',
    agent_id: agentId,
    data: { tokens, cost, ...overrideData },
    ...overrides,
  });
}
