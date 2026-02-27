import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type {
  AgentLiveState,
  UAEPEvent,
  ServerToClientEvents,
  ClientToServerEvents,
} from '@agent-observatory/shared';
import type { StateManager } from '../core/state-manager.js';
import type { EventBus } from '../core/event-bus.js';
import type { MetricsAggregator } from '../core/metrics-aggregator.js';

type ViewType = 'dashboard' | 'pixel' | 'timeline';

interface ClientState {
  view: ViewType;
  subscribedAgents: Set<string>;
}

export function createWebSocketServer(
  httpServer: HttpServer,
  stateManager: StateManager,
  eventBus: EventBus,
  metricsAggregator: MetricsAggregator,
): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const clients = new Map<string, ClientState>();

  // Batch buffers
  let dashboardBatch: AgentLiveState[] = [];
  let pixelBatch: AgentLiveState[] = [];
  let dashboardEventBatch: UAEPEvent[] = [];

  // Dashboard batch: every 1s (agent:state + event)
  const dashboardInterval = setInterval(() => {
    const stateBatch = dashboardBatch;
    const eventBatch = dashboardEventBatch;
    dashboardBatch = [];
    dashboardEventBatch = [];
    if (stateBatch.length === 0 && eventBatch.length === 0) return;
    for (const [socketId, state] of clients) {
      if (state.view === 'dashboard') {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          for (const agentState of stateBatch) {
            socket.emit('agent:state', agentState);
          }
          for (const evt of eventBatch) {
            socket.emit('event', evt);
          }
        }
      }
    }
  }, 1000);

  // Pixel batch: every 100ms
  const pixelInterval = setInterval(() => {
    if (pixelBatch.length === 0) return;
    const batch = pixelBatch;
    pixelBatch = [];
    for (const [socketId, state] of clients) {
      if (state.view === 'pixel') {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          for (const agentState of batch) {
            socket.emit('agent:state', agentState);
          }
        }
      }
    }
  }, 100);

  // Metrics snapshot: every 5s
  const metricsInterval = setInterval(() => {
    const snapshot = metricsAggregator.getSnapshot();
    io.emit('metrics:snapshot', snapshot);
  }, 5000);

  // State change -> batch
  stateManager.onChange((agentState) => {
    dashboardBatch.push(agentState);
    pixelBatch.push(agentState);

    // timeline view gets immediate updates
    for (const [socketId, state] of clients) {
      if (state.view === 'timeline') {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('agent:state', agentState);
        }
      }
    }
  });

  // Agent remove — flush pending batched state updates before emitting remove
  // to prevent stale agent:state from re-adding agent after agent:remove
  stateManager.onRemove((agentId) => {
    dashboardBatch = dashboardBatch.filter((s) => s.agent_id !== agentId);
    pixelBatch = pixelBatch.filter((s) => s.agent_id !== agentId);
    io.emit('agent:remove', { agent_id: agentId });
  });

  // Forward events to clients:
  // - dashboard view: all events batched (1s interval via dashboardEventBatch)
  // - other views: only subscribed agent events (immediate)
  eventBus.subscribe((event: UAEPEvent) => {
    // Always add to dashboard batch — flush sends only to dashboard-view clients
    dashboardEventBatch.push(event);

    // Subscribed agents get immediate events (non-dashboard views only)
    for (const [socketId, state] of clients) {
      if (state.view !== 'dashboard' && state.subscribedAgents.has(event.agent_id)) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('event', event);
        }
      }
    }
  });

  io.on('connection', (socket) => {
    const clientState: ClientState = {
      view: 'dashboard',
      subscribedAgents: new Set(),
    };
    clients.set(socket.id, clientState);

    // Send init
    const agents = stateManager.getAllAgents();
    const metrics = metricsAggregator.getSnapshot();
    socket.emit('init', { agents, metrics });

    socket.on('subscribe', (agentId: string) => {
      clientState.subscribedAgents.add(agentId);
    });

    socket.on('unsubscribe', (agentId: string) => {
      clientState.subscribedAgents.delete(agentId);
    });

    socket.on('set_view', (viewType: ViewType) => {
      clientState.view = viewType;
    });

    socket.on('disconnect', () => {
      clients.delete(socket.id);
    });
  });

  // Cleanup on server close
  const origClose = io.close.bind(io);
  io.close = (fn?: (err?: Error) => void) => {
    clearInterval(dashboardInterval);
    clearInterval(pixelInterval);
    clearInterval(metricsInterval);
    return origClose(fn);
  };

  return io;
}
