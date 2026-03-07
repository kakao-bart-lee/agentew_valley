import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import { makeEvent, makeSessionStart, makeToolStart } from './helpers.js';

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
        const address = instance.server.address();
        port = typeof address === 'object' && address ? address.port : 0;
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

  it('sends init event on connection', async () => {
    const socket = connect();
    const initData = await waitFor<{ agents: unknown[]; metrics: unknown }>(socket, 'init');
    expect(initData.agents).toEqual([]);
    expect(initData.metrics).toBeDefined();
  });

  it('sends agent:state in dashboard batch updates', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    const statePromise = waitFor<{ agent_id: string; status: string }>(socket, 'agent:state', 4000);
    instance.eventBus.publish(makeSessionStart('agent-ws'));

    const state = await statePromise;
    expect(state.agent_id).toBe('agent-ws');
    expect(state.status).toBe('idle');
  });

  it('sends agent:remove on session end', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    instance.eventBus.publish(makeSessionStart('agent-ws', 'session-1'));

    const removePromise = waitFor<{ agent_id: string }>(socket, 'agent:remove');
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

  it('sends subscribed agent events on non-dashboard views', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    socket.emit('set_view', 'pixel');
    socket.emit('subscribe', 'agent-sub');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const eventPromise = waitFor<{ agent_id: string; type: string }>(socket, 'event');
    instance.eventBus.publish(makeToolStart('Read', 'agent-sub'));

    const received = await eventPromise;
    expect(received.agent_id).toBe('agent-sub');
    expect(received.type).toBe('tool.start');
  });

  it('broadcasts all events to dashboard-view clients in a batch', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    const events: Array<{ agent_id: string; type: string }> = [];
    socket.on('event', (event: { agent_id: string; type: string }) => {
      events.push(event);
    });

    instance.eventBus.publish(makeToolStart('Read', 'agent-a'));
    instance.eventBus.publish(makeToolStart('Write', 'agent-b'));

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(events).toHaveLength(2);
    expect(events[0].agent_id).toBe('agent-a');
    expect(events[1].agent_id).toBe('agent-b');
  });

  it('does not send events to non-dashboard views without subscribe', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    socket.emit('set_view', 'pixel');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events: unknown[] = [];
    socket.on('event', (event: unknown) => {
      events.push(event);
    });

    instance.eventBus.publish(makeToolStart('Read', 'agent-no-sub'));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(events).toHaveLength(0);
  });

  it('does not emit removed semantic legacy websocket channels', async () => {
    const socket = connect();
    await waitFor(socket, 'init');

    const seen = {
      taskUpdated: false,
      approvalCreated: false,
      activityLogged: false,
    };

    socket.on('task.updated', () => {
      seen.taskUpdated = true;
    });
    socket.on('approval.created', () => {
      seen.approvalCreated = true;
    });
    socket.on('activity.logged', () => {
      seen.activityLogged = true;
    });

    instance.eventBus.publish(makeEvent({
      type: 'task.sync',
      source: 'mission_control',
      agent_id: 'observatory',
      session_id: 'legacy-session',
      data: {
        id: 'T-1',
        title: 'Legacy event',
        status: 'assigned',
        priority: 'medium',
        updated_at: Math.floor(Date.now() / 1000),
      },
    }));
    instance.eventBus.publish(makeEvent({
      type: 'approval.created',
      source: 'mission_control',
      agent_id: 'observatory',
      session_id: 'legacy-session',
      data: { approval: { id: 'approval-1', requested_by: 'agent-1', status: 'pending', type: 'dangerous_action', created_at: Date.now() } },
    }));
    instance.eventBus.publish(makeEvent({
      type: 'activity.new',
      source: 'mission_control',
      agent_id: 'observatory',
      session_id: 'legacy-session',
      data: {
        id: 'activity-1',
        type: 'task_comment',
        actor_type: 'agent',
        entity_type: 'task',
        entity_id: 'T-1',
        created_at: Math.floor(Date.now() / 1000),
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(seen).toEqual({ taskUpdated: false, approvalCreated: false, activityLogged: false });
  });
});
