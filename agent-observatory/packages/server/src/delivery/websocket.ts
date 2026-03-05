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
    io.emit('agent.status', { agent: agentState });

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

    if (event.type === 'task.sync' && typeof event.data?.['id'] === 'string') {
      const payload = {
        task_id: event.data['id'] as string,
      };
      io.emit('task.updated', payload);
      if (event.data?.['checkout_agent_id']) {
        io.emit('task.checkout', payload);
      }
    }

    if (event.type === 'activity.new' && typeof event.data?.['id'] === 'string') {
      const activityPayload = {
        id: event.data['id'] as string,
        type: String(event.data?.['type'] ?? 'activity'),
        actor: typeof event.data?.['actor'] === 'string' ? event.data['actor'] as string : undefined,
        actor_type: (event.data?.['actor_type'] === 'agent'
          || event.data?.['actor_type'] === 'user'
          || event.data?.['actor_type'] === 'system'
          ? event.data['actor_type']
          : 'system') as 'agent' | 'user' | 'system',
        entity_type: (typeof event.data?.['entity_type'] === 'string' ? event.data['entity_type'] : 'task') as 'task' | 'agent' | 'approval' | 'goal' | 'session',
        entity_id: typeof event.data?.['entity_id'] === 'string' ? event.data['entity_id'] as string : undefined,
        description: typeof event.data?.['description'] === 'string' ? event.data['description'] as string : undefined,
        created_at: typeof event.data?.['created_at'] === 'number' ? event.data['created_at'] as number : Math.floor(Date.now() / 1000),
      };
      io.emit('activity.logged', activityPayload);

      if (activityPayload.type === 'budget_alert') {
        io.emit('cost.alert', {
          agent_id: typeof event.data?.['entity_id'] === 'string' ? event.data['entity_id'] as string : event.agent_id,
          severity: event.data?.['severity'] === 'critical' ? 'critical' : 'warning',
          utilization_ratio: typeof event.data?.['utilization_ratio'] === 'number' ? event.data['utilization_ratio'] as number : undefined,
          budget_monthly_cents: typeof event.data?.['budget_monthly_cents'] === 'number' ? event.data['budget_monthly_cents'] as number : undefined,
          spent_monthly_cents: typeof event.data?.['spent_monthly_cents'] === 'number' ? event.data['spent_monthly_cents'] as number : undefined,
        });
      }
    }

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
