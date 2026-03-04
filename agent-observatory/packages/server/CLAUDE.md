# @agent-observatory/server — 에이전트 가이드

## 역할
UAEP 이벤트를 수신·처리·저장·전달하는 **서버** 패키지. EventBus, StateManager, MetricsAggregator, WebSocket/REST API 제공.

## 핵심 참고 문서
- **아키텍처 문서**: `docs/agent-observatory-architecture_2026-02-27.md`
  - §7: Processing Layer 상세 (EventBus, StateManager, MetricsAggregator, HistoryStore)
  - §8: Delivery Layer 상세 (WebSocket 채널, REST API 엔드포인트)
- **FE 데이터 계약**: `docs/FE-dashboard-spec_2026-02-27.md`
  - §2: 데이터 계약 (AgentLiveState, WebSocket 이벤트, MetricsSnapshot, REST API)

## 의존성
- `@agent-observatory/shared` (UAEP 타입, AgentLiveState, MetricsSnapshot 등)
- `@agent-observatory/collectors` (Collector 인터페이스, ClaudeCodeCollector, OpenClawCollector)
- `express` (HTTP 서버)
- `socket.io` (WebSocket)
- `cors` (CORS 미들웨어)

## 구현 태스크

### 1. EventBus (`src/core/event-bus.ts`)
```typescript
import { UAEPEvent } from '@agent-observatory/shared';

type EventHandler = (event: UAEPEvent) => void;

export interface EventBus {
  publish(event: UAEPEvent): void;
  subscribe(handler: EventHandler): () => void;           // 전체 이벤트
  subscribeByAgent(agentId: string, handler: EventHandler): () => void;
  subscribeByType(type: string, handler: EventHandler): () => void;
}

// Phase 1: EventEmitter 기반 구현
export class InMemoryEventBus implements EventBus {
  // Node.js EventEmitter 사용
  // 채널: 'event' (전체), 'event:{agent_id}', 'event:{type}'
  // publish 시 3개 채널 모두에 emit
  // subscribe → unsubscribe 함수 반환 (cleanup)
}
```

### 2. StateManager (`src/core/state-manager.ts`)
```typescript
import { AgentLiveState, UAEPEvent, AgentSourceType, ToolCategory } from '@agent-observatory/shared';

export class StateManager {
  private agents: Map<string, AgentLiveState>;

  // 이벤트 → 상태 업데이트 규칙:
  //
  // session.start → 새 AgentLiveState 생성, status: 'idle'
  // session.end → 에이전트 제거 (remove 이벤트 발생)
  //
  // tool.start → status: 'acting', current_tool 설정,
  //              current_tool_category 설정, total_tool_calls++
  // tool.end → status: 'thinking' (다른 active tool 있으면) or 'idle'
  //            current_tool 해제, tool_distribution[category]++
  // tool.error → total_errors++, status_detail에 에러 요약
  //
  // agent.status → status 직접 갱신 (idle/thinking 등)
  //
  // user.input → status: 'thinking' (사용자 입력 수신 후 처리 시작)
  // user.permission → status: 'waiting_permission'
  //
  // subagent.spawn → child_agent_ids에 추가
  // subagent.end → child_agent_ids에서 제거
  //
  // metrics.usage → total_tokens/total_cost_usd 갱신
  //
  // 모든 이벤트: last_activity 갱신

  // Active tool 추적: Map<string, { tool_name, category, start_ts }>
  // tool_use.id → tool.start에서 추가, tool.end에서 제거

  getAgent(agentId: string): AgentLiveState | undefined;
  getAllAgents(): AgentLiveState[];
  getAgentsByTeam(teamId: string): AgentLiveState[];

  // 변경 알림
  onChange(handler: (state: AgentLiveState) => void): () => void;
  onRemove(handler: (agentId: string) => void): () => void;
}
```

### 3. MetricsAggregator (`src/core/metrics-aggregator.ts`)
```typescript
import { MetricsSnapshot, UAEPEvent } from '@agent-observatory/shared';

export class MetricsAggregator {
  // 1분 윈도우 슬라이딩 버퍼 (최근 1시간 = 60 슬롯)
  //
  // 각 윈도우에 기록:
  //   tokens, cost, tool_calls, errors, active_agents
  //
  // 이벤트 핸들링:
  //   tool.start → tool_calls++
  //   tool.end → 도구별 duration 기록 (start-end 차이)
  //   tool.error → errors++
  //   metrics.usage → tokens += data.tokens, cost += data.cost
  //
  // 집계 메서드:
  getSnapshot(): MetricsSnapshot;
  // MetricsSnapshot 구조:
  //   total_agents: number
  //   active_agents: number
  //   total_sessions: number
  //   total_tool_calls: number
  //   total_tokens: number
  //   total_cost_usd: number
  //   total_errors: number
  //   tokens_per_minute: number[]     (최근 60분)
  //   cost_per_minute: number[]       (최근 60분)
  //   tool_calls_per_minute: number[] (최근 60분)
  //   tool_category_distribution: Record<ToolCategory, number>
  //   error_rate: number              (최근 5분 기준)

  getTimeseries(metric: string, fromMinutesAgo: number): { ts: string; value: number }[];
}
```

### 4. HistoryStore (`src/core/history-store.ts`)
```typescript
// Phase 1: 인메모리 링 버퍼 (에이전트당 최근 500개 이벤트)
export class HistoryStore {
  private events: Map<string, UAEPEvent[]>;  // agent_id → events
  private sessionEvents: Map<string, UAEPEvent[]>;  // session_id → events

  append(event: UAEPEvent): void;

  getByAgent(agentId: string, options?: {
    limit?: number;
    offset?: number;
    type?: string;
  }): UAEPEvent[];

  getBySession(sessionId: string): UAEPEvent[];

  // Phase 2 TODO: SQLite 영속 저장소
}
```

### 5. WebSocket 서버 (`src/delivery/websocket.ts`)
```typescript
import { Server as SocketIOServer } from 'socket.io';

// Socket.IO 서버 설정
//
// 서버 → 클라이언트 이벤트:
//   'init'             → { agents: AgentLiveState[], metrics: MetricsSnapshot }
//   'agent:state'      → AgentLiveState (상태 변경 시)
//   'agent:remove'     → { agent_id: string } (세션 종료 시)
//   'event'            → UAEPEvent (실시간 이벤트)
//   'metrics:snapshot' → MetricsSnapshot (5초 간격)
//
// 클라이언트 → 서버 이벤트:
//   'subscribe'    → { agent_id: string } (특정 에이전트 구독)
//   'unsubscribe'  → { agent_id: string }
//   'set_view'     → { view: 'dashboard' | 'pixel' | 'timeline' }
//
// 연결 시:
//   1. 'init' 이벤트로 현재 전체 상태 전송
//   2. 이후 변경분만 delta로 전송
//
// 최적화:
//   - dashboard 뷰: 1초 배치 (이벤트 모아서 전송)
//   - pixel 뷰: 100ms 배치 (상태 delta만)
//   - subscribe된 에이전트만 상세 이벤트 전송

export function createWebSocketServer(
  httpServer: any,
  stateManager: StateManager,
  eventBus: EventBus,
  metricsAggregator: MetricsAggregator,
): SocketIOServer;
```

### 6. REST API (`src/delivery/api.ts`)
```typescript
import { Router } from 'express';

// Express Router 설정
//
// GET  /api/v1/agents              → stateManager.getAllAgents()
// GET  /api/v1/agents/:id          → stateManager.getAgent(id)
// GET  /api/v1/agents/:id/events   → historyStore.getByAgent(id, { limit, offset })
//
// GET  /api/v1/sessions            → 활성 세션 목록 (stateManager에서 추출)
// GET  /api/v1/sessions/:id        → historyStore.getBySession(id) + 세션 메타
//
// GET  /api/v1/metrics/summary     → metricsAggregator.getSnapshot()
// GET  /api/v1/metrics/timeseries  → metricsAggregator.getTimeseries(metric, from)
//                                    ?metric=tokens_per_minute&from=30
// GET  /api/v1/migration/shadow-report → shadow mode parity summary
//                                    shadow mode OFF: 503 + code SHADOW_MODE_DISABLED
//                                    shadow mode ON: { pass_count, fail_count, top_diffs }
//
// GET  /api/v1/config              → 현재 설정 (watchPaths, 활성 collector 목록 등)
// PUT  /api/v1/config              → 설정 변경 (런타임 collector 추가/제거)
//
// POST /api/v1/events              → 외부 UAEP 이벤트 수신 (HTTP Collector)
// POST /api/v1/events/batch        → 배치 수신
//
// 공통:
//   - JSON 응답
//   - 에러: { error: string, code: string }
//   - 페이지네이션: ?limit=50&offset=0

export function createApiRouter(
  stateManager: StateManager,
  historyStore: HistoryStore,
  metricsAggregator: MetricsAggregator,
  eventBus: EventBus,
): Router;
```

### 7. 앱 진입점 (`src/app.ts`)
```typescript
// Express + Socket.IO 앱 조립

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';

// 1. 코어 모듈 초기화
//   const eventBus = new InMemoryEventBus();
//   const stateManager = new StateManager();
//   const metricsAggregator = new MetricsAggregator();
//   const historyStore = new HistoryStore();

// 2. EventBus 구독 연결
//   eventBus.subscribe(event => stateManager.handleEvent(event));
//   eventBus.subscribe(event => metricsAggregator.handleEvent(event));
//   eventBus.subscribe(event => historyStore.append(event));

// 3. Express 앱 + HTTP 서버
//   const app = express();
//   app.use(cors());
//   app.use(express.json());
//   app.use(createApiRouter(...));

// 4. WebSocket 서버
//   createWebSocketServer(httpServer, stateManager, eventBus, metricsAggregator);

// 5. (연동) Collector 등록
//   컬렉터의 onEvent → eventBus.publish 연결

export function createApp(config?: AppConfig): { app, server, eventBus, stateManager };
```

### 8. 서버 시작 (`src/index.ts`)
```typescript
// CLI 진입점
// 환경변수:
//   PORT (기본 3000)
//   CLAUDE_CODE_WATCH_PATHS (기본 ~/.claude/projects)
//   OPENCLAW_WATCH_PATHS (기본 ~/.openclaw/agents)

// 1. createApp() 호출
// 2. Collectors 초기화 + 연결
//   const ccCollector = new ClaudeCodeCollector({...});
//   const ocCollector = new OpenClawCollector({...});
//   ccCollector.onEvent(event => eventBus.publish(event));
//   ocCollector.onEvent(event => eventBus.publish(event));
//   await ccCollector.start();
//   await ocCollector.start();
// 3. server.listen(PORT)
// 4. Graceful shutdown (SIGINT → collectors.stop() → server.close())

export { createApp } from './app.js';
```

## 테스트 전략

### 필수 테스트 파일
```
src/__tests__/
├── event-bus.test.ts
├── state-manager.test.ts
├── metrics-aggregator.test.ts
├── history-store.test.ts
├── api.test.ts
└── websocket.test.ts
```

### 테스트 케이스 (최소)

**EventBus:**
1. publish → subscribe 핸들러 호출됨
2. subscribeByAgent → 해당 agent_id 이벤트만 수신
3. subscribeByType → 해당 type 이벤트만 수신
4. unsubscribe (반환 함수 호출) → 핸들러 더 이상 호출 안 됨

**StateManager:**
5. session.start → 새 agent 생성, status: idle
6. tool.start → status: acting, current_tool 설정
7. tool.end → status: idle (마지막 tool이면), tool_distribution 갱신
8. session.end → agent 제거, onRemove 핸들러 호출
9. subagent.spawn → child_agent_ids에 추가
10. 동시 다수 에이전트 독립 상태 관리

**MetricsAggregator:**
11. tool.start 누적 → total_tool_calls 증가
12. metrics.usage → tokens/cost 합산
13. getSnapshot() → 현재 집계 스냅샷 정확성
14. 1분 윈도우 경계 전환 정확성

**REST API:**
15. GET /api/v1/agents → 200 + AgentLiveState[]
16. GET /api/v1/agents/:id (없는 ID) → 404
17. GET /api/v1/metrics/summary → MetricsSnapshot 구조 검증
18. POST /api/v1/events → 이벤트 수신 후 eventBus.publish 호출됨

**WebSocket:**
19. 연결 시 'init' 이벤트 수신
20. agent 상태 변경 → 'agent:state' 이벤트 수신
21. subscribe(agent_id) → 해당 에이전트 상세 이벤트만 수신

## 완료 기준
- `pnpm --filter @agent-observatory/server test` 전체 통과
- Mock 이벤트로 WebSocket 이벤트 전송 확인 (Socket.IO 클라이언트 테스트)
- REST API 엔드포인트 응답 확인 (supertest)
- `createApp()` → Collector 연결 → 이벤트 흐름 E2E 확인

## 주의사항
- Phase 1은 모두 인메모리 — 서버 재시작 시 데이터 유실 허용
- WebSocket 배치 전송: setInterval로 구현 (dashboard 1초, pixel 100ms)
- CORS: 개발 시 `*`, 프로덕션에서 환경변수로 제한
- Collector 연동: `src/index.ts`에서만 — `app.ts`는 Collector 무관하게 테스트 가능해야 함
- Graceful shutdown: SIGINT/SIGTERM 시 collector.stop() → server.close() 순서
- Express의 에러 미들웨어 반드시 등록 (unhandled rejection 방지)
