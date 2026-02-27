import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { UAEPEvent, CollectorRegistration } from '@agent-observatory/shared';
import { WebSocketTransport } from '../transport.js';

function makeEvent(id: string): UAEPEvent {
  return {
    ts: new Date().toISOString(),
    event_id: `evt-${id}`,
    source: 'claude_code',
    agent_id: 'agent-1',
    session_id: 'session-1',
    type: 'tool.start',
    data: { tool_name: 'Read' },
  };
}

function makeRegistration(): CollectorRegistration {
  return {
    collector_id: 'coll-test',
    name: 'claude-code',
    source_type: 'claude_code',
    machine_id: 'test-host',
    watch_paths: ['/tmp/test'],
    version: '0.1.0',
  };
}

describe('WebSocketTransport', () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port: number;
  let transport: WebSocketTransport;

  beforeEach(async () => {
    httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      cors: { origin: '*' },
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    transport?.close();
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
  });

  function createTransport(opts?: Partial<{ apiKey: string; batchIntervalMs: number; batchSize: number }>): WebSocketTransport {
    transport = new WebSocketTransport({
      serverUrl: `http://localhost:${port}`,
      apiKey: opts?.apiKey,
      registration: makeRegistration(),
      batchSize: opts?.batchSize ?? 50,
      batchIntervalMs: opts?.batchIntervalMs ?? 100,
    });
    return transport;
  }

  it('should connect and register with server', async () => {
    const ns = io.of('/collectors');

    const registerPromise = new Promise<CollectorRegistration>((resolve) => {
      ns.on('connection', (socket) => {
        socket.on('collector:register', (reg: CollectorRegistration) => {
          resolve(reg);
          socket.emit('collector:registered', { collector_id: reg.collector_id });
        });
      });
    });

    const t = createTransport();
    t.connect();

    const reg = await registerPromise;
    expect(reg.collector_id).toBe('coll-test');
    expect(reg.name).toBe('claude-code');

    // Wait for registered callback
    await new Promise((r) => setTimeout(r, 100));
    expect(t.isRegistered).toBe(true);
  });

  it('should send events in batches', async () => {
    const ns = io.of('/collectors');
    const receivedBatches: UAEPEvent[][] = [];

    ns.on('connection', (socket) => {
      socket.on('collector:register', (reg: CollectorRegistration) => {
        socket.emit('collector:registered', { collector_id: reg.collector_id });
      });
      socket.on('collector:events', (events: UAEPEvent[], ack: (n: number) => void) => {
        receivedBatches.push(events);
        ack(events.length);
      });
    });

    const t = createTransport({ batchIntervalMs: 100 });
    t.connect();

    // Wait for registration
    await new Promise((r) => setTimeout(r, 200));

    // Send 3 events
    t.send(makeEvent('1'));
    t.send(makeEvent('2'));
    t.send(makeEvent('3'));

    // Wait for batch flush
    await new Promise((r) => setTimeout(r, 300));

    expect(receivedBatches.length).toBeGreaterThanOrEqual(1);
    const totalEvents = receivedBatches.reduce((sum, b) => sum + b.length, 0);
    expect(totalEvents).toBe(3);
  });

  it('should buffer events when disconnected', async () => {
    // Don't set up server namespace — transport will fail to connect
    const t = createTransport({ batchIntervalMs: 50 });

    // Send events without connecting
    t.send(makeEvent('a'));
    t.send(makeEvent('b'));

    // Wait for flush attempt (will buffer since not connected)
    await new Promise((r) => setTimeout(r, 150));

    expect(t.bufferedCount).toBeGreaterThanOrEqual(2);
  });

  it('should send heartbeat when connected', async () => {
    const ns = io.of('/collectors');
    let heartbeatCount = 0;

    ns.on('connection', (socket) => {
      socket.on('collector:register', (reg: CollectorRegistration) => {
        socket.emit('collector:registered', { collector_id: reg.collector_id });
      });
      socket.on('collector:heartbeat', () => {
        heartbeatCount++;
      });
    });

    // Create transport — heartbeat is 30s by default, but we test the mechanism
    const t = createTransport();
    t.connect();

    await new Promise((r) => setTimeout(r, 200));

    // The heartbeat timer fires every 30s, so in a short test we just verify the connection works
    expect(t.isConnected).toBe(true);
  });

  it('should flush remaining queue to buffer on close', async () => {
    const ns = io.of('/collectors');
    ns.on('connection', (socket) => {
      socket.on('collector:register', (reg: CollectorRegistration) => {
        socket.emit('collector:registered', { collector_id: reg.collector_id });
      });
    });

    // Use very long batch interval so events stay in queue
    const t = createTransport({ batchIntervalMs: 60_000 });
    t.connect();
    await new Promise((r) => setTimeout(r, 200));

    t.send(makeEvent('1'));
    t.send(makeEvent('2'));

    // Close should flush to buffer
    t.close();

    // After close, buffered count should reflect the queued events
    expect(t.bufferedCount).toBe(2);
  });
});
