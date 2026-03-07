import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type {
  AgentLiveState,
  ClientToServerEvents,
  ServerToClientEvents,
  UAEPEvent,
} from '@agent-observatory/shared';
import type { StateManager } from '../core/state-manager.js';
import type { EventBus } from '../core/event-bus.js';
import type { MetricsAggregator } from '../core/metrics-aggregator.js';

type ViewType = 'dashboard' | 'pixel';

interface ClientState {
  view: ViewType;
  subscribedAgents: Set<string>;
}

export function createWebSocketServer(
  httpServer: HttpServer,
  stateManager: StateManager,
  eventBus: EventBus,
  metricsAggregator: MetricsAggregator,
  dashboardApiKey?: string,
): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  if (dashboardApiKey) {
    io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      if (token !== dashboardApiKey) {
        return next(new Error('Unauthorized'));
      }
      next();
    });
  }

  const clients = new Map<string, ClientState>();

  let dashboardBatch: AgentLiveState[] = [];
  let pixelBatch: AgentLiveState[] = [];
  let dashboardEventBatch: UAEPEvent[] = [];

  const dashboardInterval = setInterval(() => {
    const stateBatch = dashboardBatch;
    const eventBatch = dashboardEventBatch;
    dashboardBatch = [];
    dashboardEventBatch = [];
    if (stateBatch.length === 0 && eventBatch.length === 0) return;

    for (const [socketId, state] of clients) {
      if (state.view !== 'dashboard') continue;
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;

      for (const agentState of stateBatch) {
        socket.emit('agent:state', agentState);
      }
      for (const event of eventBatch) {
        socket.emit('event', event);
      }
    }
  }, 1000);

  const pixelInterval = setInterval(() => {
    if (pixelBatch.length === 0) return;
    const batch = pixelBatch;
    pixelBatch = [];

    for (const [socketId, state] of clients) {
      if (state.view !== 'pixel') continue;
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;

      for (const agentState of batch) {
        socket.emit('agent:state', agentState);
      }
    }
  }, 100);

  const metricsInterval = setInterval(() => {
    const snapshot = metricsAggregator.getSnapshot();
    io.emit('metrics:snapshot', snapshot);
  }, 5000);

  stateManager.onChange((agentState) => {
    dashboardBatch.push(agentState);
    pixelBatch.push(agentState);
    io.emit('agent.status', { agent: agentState });
  });

  stateManager.onRemove((agentId) => {
    dashboardBatch = dashboardBatch.filter((state) => state.agent_id !== agentId);
    pixelBatch = pixelBatch.filter((state) => state.agent_id !== agentId);
    io.emit('agent:remove', { agent_id: agentId });
  });

  eventBus.subscribe((event) => {
    dashboardEventBatch.push(event);

    for (const [socketId, state] of clients) {
      if (state.view === 'dashboard' || !state.subscribedAgents.has(event.agent_id)) {
        continue;
      }
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('event', event);
      }
    }
  });

  io.on('connection', (socket) => {
    const clientState: ClientState = {
      view: 'dashboard',
      subscribedAgents: new Set(),
    };
    clients.set(socket.id, clientState);

    socket.emit('init', {
      agents: stateManager.getAllAgents(),
      metrics: metricsAggregator.getSnapshot(),
    });

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

  const originalClose = io.close.bind(io);
  io.close = (fn?: (err?: Error) => void) => {
    clearInterval(dashboardInterval);
    clearInterval(pixelInterval);
    clearInterval(metricsInterval);
    return originalClose(fn);
  };

  return io;
}
