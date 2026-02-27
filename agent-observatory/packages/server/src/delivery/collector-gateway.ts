/**
 * Collector WebSocket Gateway.
 *
 * Socket.IO `/collectors` 네임스페이스로 원격 Collector와 통신.
 * FE용 기본 네임스페이스(`/`)와 완전히 분리.
 */

import type { Server as SocketIOServer, Namespace, Socket } from 'socket.io';
import type {
  CollectorRegistration,
  ConnectedCollector,
  CollectorToServerEvents,
  ServerToCollectorEvents,
  UAEPEvent,
} from '@agent-observatory/shared';
import { isValidUAEPEvent } from '@agent-observatory/shared';
import type { EventBus } from '../core/event-bus.js';

export interface CollectorGateway {
  getConnectedCollectors(): ConnectedCollector[];
  close(): void;
}

function isValidRegistration(reg: unknown): reg is CollectorRegistration {
  if (!reg || typeof reg !== 'object') return false;
  const r = reg as Record<string, unknown>;
  return (
    typeof r.collector_id === 'string' &&
    r.collector_id.length > 0 &&
    typeof r.name === 'string' &&
    r.name.length > 0 &&
    typeof r.source_type === 'string' &&
    typeof r.machine_id === 'string' &&
    Array.isArray(r.watch_paths) &&
    typeof r.version === 'string'
  );
}

export function createCollectorGateway(
  io: SocketIOServer,
  eventBus: EventBus,
  apiKeys: string[],
): CollectorGateway {
  const ns: Namespace<CollectorToServerEvents, ServerToCollectorEvents> = io.of('/collectors');
  const connected = new Map<string, ConnectedCollector>();
  // Map socket.id → collector_id for cleanup on disconnect
  const socketToCollector = new Map<string, string>();

  // Auth middleware: validate API key from handshake
  ns.use((socket: Socket, next) => {
    if (apiKeys.length === 0) {
      return next();
    }
    const key = socket.handshake.auth?.apiKey as string | undefined;
    if (!key || !apiKeys.includes(key)) {
      return next(new Error('AUTH_FAILED'));
    }
    next();
  });

  ns.on('connection', (socket) => {
    console.log(`[collector-gateway] Socket connected: ${socket.id}`);

    // collector:register — validate and save registration info
    socket.on('collector:register', (reg: unknown) => {
      if (!isValidRegistration(reg)) {
        socket.emit('collector:error', { code: 'INVALID_REGISTRATION', message: 'Missing required registration fields' });
        return;
      }

      const now = new Date().toISOString();
      const entry: ConnectedCollector = {
        collector_id: reg.collector_id,
        name: reg.name,
        source_type: reg.source_type,
        machine_id: reg.machine_id,
        connected_at: now,
        last_heartbeat: now,
        events_received: 0,
      };
      connected.set(reg.collector_id, entry);
      socketToCollector.set(socket.id, reg.collector_id);

      console.log(
        `[collector-gateway] Registered: ${reg.name} (${reg.collector_id}) from ${reg.machine_id}`,
      );
      socket.emit('collector:registered', { collector_id: reg.collector_id });
    });

    // collector:events — batch event ingestion
    socket.on('collector:events', (events: UAEPEvent[], ack) => {
      const collectorId = socketToCollector.get(socket.id);
      let accepted = 0;

      for (const event of events) {
        if (isValidUAEPEvent(event)) {
          eventBus.publish(event);
          accepted++;
        } else {
          console.warn(`[collector-gateway] Dropping invalid event from ${collectorId ?? socket.id}`);
        }
      }

      // Update events_received counter (only valid events)
      if (collectorId) {
        const entry = connected.get(collectorId);
        if (entry) {
          entry.events_received += accepted;
          entry.last_heartbeat = new Date().toISOString();
        }
      }

      // Always ACK the full batch length so the client doesn't re-buffer
      if (typeof ack === 'function') {
        ack(events.length);
      }
    });

    // collector:heartbeat — keep-alive
    socket.on('collector:heartbeat', () => {
      const collectorId = socketToCollector.get(socket.id);
      if (collectorId) {
        const entry = connected.get(collectorId);
        if (entry) {
          entry.last_heartbeat = new Date().toISOString();
        }
      }
    });

    // disconnect — remove from connected map
    socket.on('disconnect', () => {
      const collectorId = socketToCollector.get(socket.id);
      if (collectorId) {
        connected.delete(collectorId);
        socketToCollector.delete(socket.id);
        console.log(`[collector-gateway] Disconnected: ${collectorId}`);
      }
    });
  });

  return {
    getConnectedCollectors(): ConnectedCollector[] {
      // Return shallow copies to prevent external mutation of tracked state
      return Array.from(connected.values()).map((c) => ({ ...c }));
    },
    close(): void {
      ns.disconnectSockets(true);
      connected.clear();
      socketToCollector.clear();
    },
  };
}
