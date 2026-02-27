import { EventEmitter } from 'node:events';
import type { UAEPEvent } from '@agent-observatory/shared';

type EventHandler = (event: UAEPEvent) => void;

export interface EventBus {
  publish(event: UAEPEvent): void;
  subscribe(handler: EventHandler): () => void;
  subscribeByAgent(agentId: string, handler: EventHandler): () => void;
  subscribeByType(type: string, handler: EventHandler): () => void;
}

const CH_ALL = 'event';
const chAgent = (id: string) => `event:agent:${id}`;
const chType = (t: string) => `event:type:${t}`;

export class InMemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: UAEPEvent): void {
    this.emitter.emit(CH_ALL, event);
    this.emitter.emit(chAgent(event.agent_id), event);
    this.emitter.emit(chType(event.type), event);
  }

  subscribe(handler: EventHandler): () => void {
    this.emitter.on(CH_ALL, handler);
    return () => {
      this.emitter.off(CH_ALL, handler);
    };
  }

  subscribeByAgent(agentId: string, handler: EventHandler): () => void {
    const ch = chAgent(agentId);
    this.emitter.on(ch, handler);
    return () => {
      this.emitter.off(ch, handler);
    };
  }

  subscribeByType(type: string, handler: EventHandler): () => void {
    const ch = chType(type);
    this.emitter.on(ch, handler);
    return () => {
      this.emitter.off(ch, handler);
    };
  }
}
