import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import type { AppInstance } from '../app.js';
import type { CollectorRegistration, UAEPEvent } from '@agent-observatory/shared';

function waitFor<T>(socket: ClientSocket, event: string, timeout = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function makeRegistration(overrides: Partial<CollectorRegistration> = {}): CollectorRegistration {
  return {
    collector_id: 'coll-001',
    name: 'claude-code',
    source_type: 'claude_code',
    machine_id: 'test-host',
    watch_paths: ['/tmp/test'],
    version: '0.1.0',
    ...overrides,
  };
}

function makeTestEvent(agentId = 'agent-1'): UAEPEvent {
  return {
    ts: new Date().toISOString(),
    event_id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'claude_code',
    agent_id: agentId,
    session_id: 'session-1',
    type: 'tool.start',
    data: { tool_name: 'Read' },
  };
}

describe('Collector WebSocket Gateway', () => {
  let instance: AppInstance;
  let client: ClientSocket;
  let port: number;

  beforeEach(async () => {
    instance = createApp({ collectorApiKeys: ['test-key-1', 'test-key-2'] });
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
    instance.close();
  });

  function connectCollector(apiKey?: string): ClientSocket {
    client = ioc(`http://localhost:${port}/collectors`, {
      transports: ['websocket'],
      forceNew: true,
      auth: apiKey ? { apiKey } : undefined,
    });
    return client;
  }

  it('should reject connection without API key', async () => {
    const socket = connectCollector();
    const err = await waitFor<Error>(socket, 'connect_error');
    expect(err.message).toContain('AUTH_FAILED');
  });

  it('should reject connection with invalid API key', async () => {
    const socket = connectCollector('wrong-key');
    const err = await waitFor<Error>(socket, 'connect_error');
    expect(err.message).toContain('AUTH_FAILED');
  });

  it('should accept connection with valid API key', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');
    expect(socket.connected).toBe(true);
  });

  it('should register collector and respond with collector:registered', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(socket, 'collector:registered');
    socket.emit('collector:register', reg);

    const data = await registeredPromise;
    expect(data.collector_id).toBe('coll-001');
  });

  it('should reject invalid registration payload', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const errorPromise = waitFor<{ code: string; message: string }>(socket, 'collector:error');
    socket.emit('collector:register', { invalid: true });

    const err = await errorPromise;
    expect(err.code).toBe('INVALID_REGISTRATION');
  });

  it('should track connected collectors', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(socket, 'collector:registered');
    socket.emit('collector:register', reg);
    await registeredPromise;

    const collectors = instance.collectorGateway.getConnectedCollectors();
    expect(collectors).toHaveLength(1);
    expect(collectors[0].collector_id).toBe('coll-001');
    expect(collectors[0].name).toBe('claude-code');
    expect(collectors[0].machine_id).toBe('test-host');
    expect(collectors[0].events_received).toBe(0);
  });

  it('should receive events and publish to eventBus', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(socket, 'collector:registered');
    socket.emit('collector:register', reg);
    await registeredPromise;

    // Track published events
    const published: UAEPEvent[] = [];
    instance.eventBus.subscribe((event) => published.push(event));

    // Send batch of events
    const events = [makeTestEvent('agent-a'), makeTestEvent('agent-b')];
    const ackPromise = new Promise<number>((resolve) => {
      socket.emit('collector:events', events, (count: number) => resolve(count));
    });

    const ackCount = await ackPromise;
    // Server always ACKs the full batch length
    expect(ackCount).toBe(2);

    // Events should be published
    expect(published.length).toBeGreaterThanOrEqual(2);

    // Collector events_received should reflect only valid events
    const collectors = instance.collectorGateway.getConnectedCollectors();
    expect(collectors[0].events_received).toBe(2);
  });

  it('should ACK full batch length even when some events are invalid', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(socket, 'collector:registered');
    socket.emit('collector:register', reg);
    await registeredPromise;

    // Send mix of valid and invalid events
    const events = [
      makeTestEvent('agent-a'),
      { invalid: true } as unknown as UAEPEvent,
      makeTestEvent('agent-c'),
    ];

    const ackPromise = new Promise<number>((resolve) => {
      socket.emit('collector:events', events, (count: number) => resolve(count));
    });

    // ACK returns full batch length (3), not just valid count (2)
    const ackCount = await ackPromise;
    expect(ackCount).toBe(3);

    // But only 2 valid events are counted in events_received
    const collectors = instance.collectorGateway.getConnectedCollectors();
    expect(collectors[0].events_received).toBe(2);
  });

  it('should remove collector on disconnect', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(socket, 'collector:registered');
    socket.emit('collector:register', reg);
    await registeredPromise;

    expect(instance.collectorGateway.getConnectedCollectors()).toHaveLength(1);

    // Disconnect
    socket.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    expect(instance.collectorGateway.getConnectedCollectors()).toHaveLength(0);
  });

  it('should update heartbeat timestamp', async () => {
    const socket = connectCollector('test-key-1');
    await waitFor(socket, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(socket, 'collector:registered');
    socket.emit('collector:register', reg);
    await registeredPromise;

    const before = instance.collectorGateway.getConnectedCollectors()[0].last_heartbeat;

    await new Promise((r) => setTimeout(r, 20));
    socket.emit('collector:heartbeat');
    await new Promise((r) => setTimeout(r, 50));

    const after = instance.collectorGateway.getConnectedCollectors()[0].last_heartbeat;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('should allow open access when no API keys configured', async () => {
    // Close existing instance
    if (client?.connected) client.disconnect();
    await new Promise<void>((resolve) => {
      instance.io.close(() => resolve());
    });
    instance.close();

    // Create new instance without API keys
    instance = createApp({ collectorApiKeys: [] });
    await new Promise<void>((resolve) => {
      instance.server.listen(0, () => {
        const addr = instance.server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });

    client = ioc(`http://localhost:${port}/collectors`, {
      transports: ['websocket'],
      forceNew: true,
    });

    await waitFor(client, 'connect');
    expect(client.connected).toBe(true);
  });

  it('should return empty list when no collectors connected', async () => {
    const res = await fetch(`http://localhost:${port}/api/v1/collectors`);
    const body = (await res.json()) as { collectors: unknown[]; total: number };
    expect(res.status).toBe(200);
    expect(body.collectors).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('should return connected collectors via REST API', async () => {
    // Connect a collector
    client = ioc(`http://localhost:${port}/collectors`, {
      transports: ['websocket'],
      forceNew: true,
      auth: { apiKey: 'test-key-1' },
    });
    await waitFor(client, 'connect');

    const reg = makeRegistration();
    const registeredPromise = waitFor<{ collector_id: string }>(client, 'collector:registered');
    client.emit('collector:register', reg);
    await registeredPromise;

    const res = await fetch(`http://localhost:${port}/api/v1/collectors`);
    const body = (await res.json()) as { collectors: Array<{ collector_id: string }>; total: number };
    expect(res.status).toBe(200);
    expect(body.collectors).toHaveLength(1);
    expect(body.collectors[0].collector_id).toBe('coll-001');
    expect(body.total).toBe(1);
  });
});
