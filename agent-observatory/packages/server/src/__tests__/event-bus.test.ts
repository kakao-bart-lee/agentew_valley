import { describe, it, expect, vi } from 'vitest';
import { InMemoryEventBus } from '../core/event-bus.js';
import { makeEvent } from './helpers.js';

describe('InMemoryEventBus', () => {
  it('should call subscribe handler on publish', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe(handler);

    const event = makeEvent({ type: 'tool.start' });
    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should only deliver events to subscribeByAgent for matching agent_id', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribeByAgent('agent-1', handler);

    const event1 = makeEvent({ type: 'tool.start', agent_id: 'agent-1' });
    const event2 = makeEvent({ type: 'tool.start', agent_id: 'agent-2' });

    bus.publish(event1);
    bus.publish(event2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event1);
  });

  it('should only deliver events to subscribeByType for matching type', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribeByType('tool.start', handler);

    const toolStart = makeEvent({ type: 'tool.start' });
    const toolEnd = makeEvent({ type: 'tool.end' });

    bus.publish(toolStart);
    bus.publish(toolEnd);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(toolStart);
  });

  it('should stop calling handler after unsubscribe', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsub = bus.subscribe(handler);

    bus.publish(makeEvent({ type: 'tool.start' }));
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    bus.publish(makeEvent({ type: 'tool.end' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should stop calling handler after unsubscribeByAgent', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsub = bus.subscribeByAgent('agent-1', handler);

    bus.publish(makeEvent({ type: 'tool.start', agent_id: 'agent-1' }));
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    bus.publish(makeEvent({ type: 'tool.end', agent_id: 'agent-1' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should support multiple subscribers', () => {
    const bus = new InMemoryEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe(h1);
    bus.subscribe(h2);

    bus.publish(makeEvent({ type: 'session.start' }));

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
