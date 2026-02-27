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

    // collector:register — save registration info
    socket.on('collector:register', (reg: CollectorRegistration) => {
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
        }
      }

      // Update events_received counter
      if (collectorId) {
        const entry = connected.get(collectorId);
        if (entry) {
          entry.events_received += accepted;
          entry.last_heartbeat = new Date().toISOString();
        }
      }

      if (typeof ack === 'function') {
        ack(accepted);
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
      return Array.from(connected.values());
    },
    close(): void {
      ns.disconnectSockets(true);
      connected.clear();
      socketToCollector.clear();
    },
  };
}
