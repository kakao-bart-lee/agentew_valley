import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { makeEvent, makeSessionStart, makeToolStart, makeToolEnd } from './helpers.js';

function waitFor<T>(socket: ClientSocket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('WebSocket Server', () => {
  let instance: AppInstance;
  let client: ClientSocket;
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
    if (client?.connected) {
      client.disconnect();
    }
    await new Promise<void>((resolve) => {
      instance.io.close(() => resolve());
    });
  });

  function connect(): ClientSocket {
    client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true,
    });
    return client;
  }

  it('should send init event on connection', async () => {
    const socket = connect();
    const initData = await waitFor<{ agents: unknown[]; metrics: unknown }>(socket, 'init');
    expect(initData.agents).toEqual([]);
    expect(initData.metrics).toBeDefined();
  });

  it('should send agent:state on state change', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    // Set view to timeline for immediate delivery
    socket.emit('set_view', 'timeline');

    // Small delay to ensure view is set
    await new Promise((r) => setTimeout(r, 50));

    const statePromise = waitFor<{ agent_id: string; status: string }>(
      socket,
      'agent:state',
    );

    instance.eventBus.publish(makeSessionStart('agent-ws'));

    const state = await statePromise;
    expect(state.agent_id).toBe('agent-ws');
    expect(state.status).toBe('idle');
  });

  it('should send agent:remove on session end', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    instance.eventBus.publish(makeSessionStart('agent-ws'));

    const removePromise = waitFor<{ agent_id: string }>(socket, 'agent:remove');
    instance.eventBus.publish(
      makeToolStart('Read', 'agent-ws').type === 'tool.start'
        ? { ...makeSessionStart('agent-ws'), type: 'session.end' as const }
        : makeSessionStart('agent-ws'),
    );

    // Publish a session.end properly
    instance.eventBus.publish({
      ts: new Date().toISOString(),
      event_id: 'evt-remove',
      source: 'claude_code',
      agent_id: 'agent-ws',
      session_id: 'session-1',
      type: 'session.end',
    });

    const removed = await removePromise;
    expect(removed.agent_id).toBe('agent-ws');
  });

  it('should send subscribed agent events on subscribe (non-dashboard view)', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    // Switch to timeline view for immediate subscribe-based delivery
    socket.emit('set_view', 'timeline');
    socket.emit('subscribe', 'agent-sub');

    // Small delay for subscription + view change
    await new Promise((r) => setTimeout(r, 50));

    const eventPromise = waitFor<{ agent_id: string; type: string }>(socket, 'event');

    const toolEvent = makeToolStart('Read', 'agent-sub');
    instance.eventBus.publish(toolEvent);

    const received = await eventPromise;
    expect(received.agent_id).toBe('agent-sub');
    expect(received.type).toBe('tool.start');
  });

  it('should broadcast all events to dashboard-view clients (batched)', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    // Default view is dashboard — should receive ALL events via batch
    const events: Array<{ agent_id: string; type: string }> = [];
    socket.on('event', (evt: { agent_id: string; type: string }) => {
      events.push(evt);
    });

    // Publish events from different agents (no explicit subscribe)
    instance.eventBus.publish(makeToolStart('Read', 'agent-a'));
    instance.eventBus.publish(makeToolStart('Write', 'agent-b'));

    // Wait for 1s batch flush
    await new Promise((r) => setTimeout(r, 1500));

    expect(events.length).toBe(2);
    expect(events[0].agent_id).toBe('agent-a');
    expect(events[1].agent_id).toBe('agent-b');
  });

  it('should not send events to non-dashboard view without subscribe', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    socket.emit('set_view', 'timeline');
    await new Promise((r) => setTimeout(r, 50));

    const events: unknown[] = [];
    socket.on('event', (evt: unknown) => {
      events.push(evt);
    });

    // Publish event without subscribing
    instance.eventBus.publish(makeToolStart('Read', 'agent-no-sub'));

    // Wait a bit — should not receive any events
    await new Promise((r) => setTimeout(r, 200));

    expect(events.length).toBe(0);
  });

  it('should emit semantic task and activity websocket events', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    const taskUpdatedPromise = waitFor<{ task_id: string }>(socket, 'task.updated');
    const activityPromise = waitFor<{ entity_id: string; type: string }>(socket, 'activity.logged');

    instance.eventBus.publish(makeEvent({
      type: 'task.sync',
      source: 'mission_control',
      agent_id: 'observatory',
      session_id: 'mission_control_sync',
      data: {
        id: 'T-200',
        title: 'Emit semantic event',
        status: 'assigned',
        priority: 'medium',
        updated_at: Math.floor(Date.now() / 1000),
      },
    }));
    instance.eventBus.publish(makeEvent({
      type: 'activity.new',
      source: 'mission_control',
      agent_id: 'observatory',
      session_id: 'mission_control_sync',
      data: {
        id: 'activity-1',
        type: 'task_comment',
        entity_type: 'task',
        entity_id: 'T-200',
        created_at: Math.floor(Date.now() / 1000),
      },
    }));

    const taskUpdated = await taskUpdatedPromise;
    const activity = await activityPromise;

    expect(taskUpdated.task_id).toBe('T-200');
    expect(activity.entity_id).toBe('T-200');
    expect(activity.type).toBe('task_comment');
  });
});
