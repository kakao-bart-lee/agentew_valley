/**
 * WebSocketTransport — Collector ↔ Server WebSocket 전송 계층.
 *
 * 배치 이벤트 전송, ACK 처리, 오프라인 버퍼링, 자동 재접속을 담당.
 */

import { io, Socket } from 'socket.io-client';
import type {
  UAEPEvent,
  CollectorRegistration,
  CollectorToServerEvents,
  ServerToCollectorEvents,
} from '@agent-observatory/shared';
import { EventBuffer } from './buffer.js';

export interface TransportOptions {
  serverUrl: string;
  apiKey?: string;
  registration: CollectorRegistration;
  batchSize?: number;
  batchIntervalMs?: number;
  bufferPath?: string;
}

export class WebSocketTransport {
  private socket: Socket<ServerToCollectorEvents, CollectorToServerEvents>;
  private buffer: EventBuffer;
  private batchQueue: UAEPEvent[] = [];
  private batchSize: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private registration: CollectorRegistration;
  private connected = false;
  private registered = false;

  constructor(opts: TransportOptions) {
    this.batchSize = opts.batchSize ?? 50;
    const batchIntervalMs = opts.batchIntervalMs ?? 1000;
    this.registration = opts.registration;
    this.buffer = new EventBuffer(opts.bufferPath);

    // Connect to /collectors namespace
    const url = opts.serverUrl.replace(/\/$/, '') + '/collectors';
    this.socket = io(url, {
      auth: opts.apiKey ? { apiKey: opts.apiKey } : undefined,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      autoConnect: false,
    });

    // Connection lifecycle
    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[transport] Connected to server');
      this.register();
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      this.registered = false;
      console.log(`[transport] Disconnected: ${reason}`);
    });

    this.socket.on('connect_error', (err) => {
      console.error(`[transport] Connection error: ${err.message}`);
    });

    // Server responses
    this.socket.on('collector:registered', ({ collector_id }) => {
      this.registered = true;
      console.log(`[transport] Registered as ${collector_id}`);
      // Drain any buffered events from previous disconnection
      this.drainBuffer();
    });

    this.socket.on('collector:error', ({ code, message }) => {
      console.error(`[transport] Server error: ${code} — ${message}`);
    });

    // Start batch flush timer
    this.flushTimer = setInterval(() => this.flush(), batchIntervalMs);

    // Heartbeat every 30s
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.registered) {
        this.socket.emit('collector:heartbeat');
      }
    }, 30_000);
  }

  /** Connect to the server. */
  connect(): void {
    this.socket.connect();
  }

  /** Enqueue an event for batch transmission. */
  send(event: UAEPEvent): void {
    this.batchQueue.push(event);
  }

  /** Flush queued events to server or buffer. */
  private flush(): void {
    if (this.batchQueue.length === 0) return;

    // Take up to batchSize from queue
    const batch = this.batchQueue.splice(0, this.batchSize);

    if (this.connected && this.registered) {
      this.socket.emit('collector:events', batch, (ackCount: number) => {
        if (ackCount < batch.length) {
          // Some events were rejected; buffer the unacknowledged ones
          const rejected = batch.slice(ackCount);
          this.buffer.push(rejected);
        }
      });
    } else {
      // Offline: push to buffer
      this.buffer.push(batch);
    }
  }

  /** Drain buffer contents on reconnection. */
  private drainBuffer(): void {
    if (this.buffer.size === 0) return;
    console.log(`[transport] Draining ${this.buffer.size} buffered events`);

    const drain = () => {
      if (!this.connected || !this.registered || this.buffer.size === 0) return;

      const batch = this.buffer.drain(this.batchSize);
      if (batch.length === 0) return;

      this.socket.emit('collector:events', batch, (ackCount: number) => {
        if (ackCount < batch.length) {
          // Re-buffer unacknowledged events at the front
          const rejected = batch.slice(ackCount);
          this.buffer.push(rejected);
          return;
        }
        // Continue draining
        if (this.buffer.size > 0) {
          setTimeout(drain, 100);
        } else {
          console.log('[transport] Buffer fully drained');
        }
      });
    };

    drain();
  }

  private register(): void {
    this.socket.emit('collector:register', this.registration);
  }

  /** Gracefully disconnect and clean up. */
  close(): void {
    // Flush remaining queue to buffer
    if (this.batchQueue.length > 0) {
      this.buffer.push(this.batchQueue);
      this.batchQueue = [];
    }

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.socket.disconnect();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isRegistered(): boolean {
    return this.registered;
  }

  get bufferedCount(): number {
    return this.buffer.size;
  }
}
