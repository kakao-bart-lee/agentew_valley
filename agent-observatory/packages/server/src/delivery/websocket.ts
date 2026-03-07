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
import type { HistoryStore } from '../core/history-store.js';

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
  historyStore?: HistoryStore,
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

  const unsubOnChange = stateManager.onChange((agentState) => {
    dashboardBatch.push(agentState);
    pixelBatch.push(agentState);
    io.emit('agent.status', { agent: agentState });

    // R-007: agent.health — 에러 상태 또는 에러율 변화 알림
    const errorRate = agentState.total_tool_calls > 0
      ? agentState.total_errors / agentState.total_tool_calls
      : 0;
    if (agentState.total_errors > 0 || agentState.status === 'error') {
      io.emit('agent.health', {
        agent_id: agentState.agent_id,
        status: agentState.status,
        total_errors: agentState.total_errors,
        total_tool_calls: agentState.total_tool_calls,
        error_rate: errorRate,
      });
    }
  });

  const unsubOnRemove = stateManager.onRemove((agentId) => {
    dashboardBatch = dashboardBatch.filter((state) => state.agent_id !== agentId);
    pixelBatch = pixelBatch.filter((state) => state.agent_id !== agentId);
    io.emit('agent:remove', { agent_id: agentId });
  });

  const unsubEventBus = eventBus.subscribe((event) => {
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

    // R-007: task.context — session.start 시 Paperclip 컨텍스트 브로드캐스트
    if (event.type === 'session.start' && (event.task_id || event.project_id || event.goal_id)) {
      io.emit('task.context', {
        agent_id: event.agent_id,
        session_id: event.session_id,
        project_id: event.project_id,
        task_id: event.task_id,
        goal_id: event.goal_id,
      });
    }
  });

  // R-007: cost.alert — 30초마다 budget alerts 체크, 새 alert 발생 시 emit
  const emittedAlertKeys = new Set<string>();
  const costAlertInterval = historyStore ? setInterval(() => {
    const alerts = historyStore.getBudgetAlerts();
    for (const alert of alerts) {
      const key = `${alert.agent_id}:${alert.severity}`;
      if (!emittedAlertKeys.has(key)) {
        emittedAlertKeys.add(key);
        io.emit('cost.alert', {
          agent_id: alert.agent_id,
          agent_name: alert.agent_name,
          budget_monthly_usd: alert.budget_monthly_cents / 100,
          spent_monthly_usd: alert.spent_monthly_usd,
          utilization_ratio: alert.utilization_ratio,
          severity: alert.severity,
        });
      }
    }
    // 더 이상 활성이 아닌 키 제거 (severity 불문) — warning/critical 모두 정리
    for (const key of emittedAlertKeys) {
      const stillActive = alerts.some((a) => `${a.agent_id}:${a.severity}` === key);
      if (!stillActive) emittedAlertKeys.delete(key);
    }
  }, 30_000) : null;

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
    if (costAlertInterval) clearInterval(costAlertInterval);
    unsubOnChange();
    unsubOnRemove();
    unsubEventBus();
    return originalClose(fn);
  };

  return io;
}
