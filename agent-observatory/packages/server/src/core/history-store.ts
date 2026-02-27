import type { UAEPEvent } from '@agent-observatory/shared';

const MAX_EVENTS_PER_AGENT = 500;

export class HistoryStore {
  private events = new Map<string, UAEPEvent[]>();
  private sessionEvents = new Map<string, UAEPEvent[]>();

  append(event: UAEPEvent): void {
    // by agent
    let agentEvents = this.events.get(event.agent_id);
    if (!agentEvents) {
      agentEvents = [];
      this.events.set(event.agent_id, agentEvents);
    }
    agentEvents.push(event);
    if (agentEvents.length > MAX_EVENTS_PER_AGENT) {
      agentEvents.splice(0, agentEvents.length - MAX_EVENTS_PER_AGENT);
    }

    // by session
    let sessEvents = this.sessionEvents.get(event.session_id);
    if (!sessEvents) {
      sessEvents = [];
      this.sessionEvents.set(event.session_id, sessEvents);
    }
    sessEvents.push(event);
    if (sessEvents.length > MAX_EVENTS_PER_AGENT) {
      sessEvents.splice(0, sessEvents.length - MAX_EVENTS_PER_AGENT);
    }
  }

  getByAgent(
    agentId: string,
    options?: { limit?: number; offset?: number; type?: string },
  ): UAEPEvent[] {
    let events = this.events.get(agentId) ?? [];

    if (options?.type) {
      events = events.filter((e) => e.type === options.type);
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;

    return events.slice(offset, offset + limit);
  }

  getBySession(sessionId: string): UAEPEvent[] {
    return this.sessionEvents.get(sessionId) ?? [];
  }

  getAgentEventCount(agentId: string): number {
    return this.events.get(agentId)?.length ?? 0;
  }

  getSessionIds(): string[] {
    return Array.from(this.sessionEvents.keys());
  }
}
