# FE 에이전트 팀 핸드오프 — 2026-02-27 (v4)

> 백엔드 팀(본체)에서 FE 에이전트 팀에 전달하는 작업 현황 및 다음 단계 가이드.
>
> **v4 업데이트**: Phase 3 백엔드 구현 완료 반영 — 세션 재생 API, 비용/토큰 분석 API 5종, OpenAPI 문서 자동 생성(Swagger UI), 테스트 255개 통과.

---

## 1. Phase 3 완료 — 세션 재생 · 비용 분석 · OpenAPI 문서

### v4에서 추가된 백엔드 기능

| 기능 | 설명 | FE 영향 |
|------|------|---------|
| **세션 재생 API** | `GET /sessions/:id/replay` — gap_ms/offset_ms 포함 이벤트 시퀀스 반환 | 세션 재생(Playback) UI 구현 가능 |
| **비용 분석 API** | `/analytics/cost`, `/cost/by-agent`, `/cost/by-team`, `/cost/by-tool` — 비용 요약·시계열·그룹별 분석 | 비용 대시보드·차트 구현 가능 |
| **토큰 분석 API** | `/analytics/tokens` — 토큰 시계열 + 에이전트별 분석 | 토큰 사용량 차트 구현 가능 |
| **OpenAPI 문서** | `GET /api-docs/` → Swagger UI, `GET /api-docs/openapi.json` → 스펙 JSON | API 탐색·테스트 도구로 활용 |

### 이전 핸드오프 (v1~v3) 요약

| 버전 | 내용 |
|------|------|
| v1 | 패키지 구조 정합성 수정 (타입 re-export, useSocket 싱글턴, Mock 조건부 로드) |
| v2 | dashboard 뷰 클라이언트에게 모든 이벤트 broadcast 적용 |
| v3 | Phase 2 — SQLite 영속화, 계층/팀/검색 API, Agent SDK/HTTP Collector |

> **타입 규칙**: web 패키지에서 타입을 직접 정의하지 마세요. 모든 도메인 타입은 `@agent-observatory/shared`에서 가져옵니다.

---

## 2. 현재 FE 구현 현황 vs 스펙 대비 GAP

`docs/FE-dashboard-spec_2026-02-27.md` (§4 컴포넌트 구조) 기준 현황:

### 구현 완료

| 컴포넌트 | 파일 | 비고 |
|---------|------|------|
| DashboardView | `DashboardView.tsx` | 레이아웃 조합, 반응형 기본 구조 |
| StatusBar | `StatusBar.tsx` | 연결상태, Active/Tokens/Cost/Errors 표시 |
| AgentCard | `AgentCard.tsx` | 소스 뱃지, 상태 표시등, 도구, 메트릭 |
| AgentCardGrid | `AgentCardGrid.tsx` | 그리드 레이아웃, 필터 연동, 정렬 |
| AgentCardFilters | `AgentCardFilters.tsx` | 소스/상태 필터 (기본) |
| MetricsPanel | `MetricsPanel.tsx` | Tokens/min 라인차트, Tool 바차트, Source 파이차트 |
| ActivityFeed | `ActivityFeed.tsx` | Pause/Clear, 200개 버퍼 |
| ActivityFeedItem | `ActivityFeedItem.tsx` | 이벤트 타입별 렌더링 |
| RelationshipGraph | `RelationshipGraph.tsx` | CSS 기반 트리 (단순) |
| useSocket | `hooks/useSocket.ts` | 싱글턴, init/state/remove/metrics 수신 |
| useActivityFeed | `hooks/useActivityFeed.ts` | 이벤트 버퍼+필터 |
| agentStore | `stores/agentStore.ts` | Zustand, agents Map, 필터 |
| metricsStore | `stores/metricsStore.ts` | Zustand, MetricsSnapshot |
| 유틸리티 | `utils/{colors,formatters,sorting}.ts` | 색상맵, 포맷, 정렬 |

### 미구현 (스펙 대비 GAP)

| 스펙 항목 | 파일 (예정) | 설명 |
|----------|------------|------|
| **charts/ 서브디렉토리** | `charts/TokensChart.tsx` 등 | 현재 MetricsPanel에 인라인. 스펙은 개별 차트 컴포넌트 분리 요구 |
| **CostChart** | `charts/CostChart.tsx` | Cost/hr 라인차트 누락 |
| **ActiveAgentsChart** | `charts/ActiveAgentsChart.tsx` | 활성 에이전트 시계열 에어리어 차트 누락 |
| **ActivityFeedFilters** | `ActivityFeedFilters.tsx` | 에이전트별/이벤트타입별 피드 필터 UI 누락 |
| **팀 필터** | `AgentCardFilters.tsx` | team_id 기반 필터 버튼 미구현 (store에 teamFilter는 있음) |
| **카드 정렬 모드 UI** | `AgentCardGrid.tsx` | 정렬 모드 전환 UI 없음 (코드상 `'status'` 하드코딩) |
| **카드 클릭 → 상세패널** | `AgentDetailPanel.tsx` | 공통 사이드패널, 에이전트 상세 + 이벤트 히스토리 |
| **subscribe/unsubscribe** | `useSocket.ts` | 특정 에이전트 구독 (카드 클릭 시) 미구현 |
| **set_view emit** | `useSocket.ts` | 뷰 전환 시 서버에 `set_view` 전송 — 현재 connect 시 1회만 |
| **도구분포 미니바** | `AgentCard.tsx` | 카드 하단 미니 bar 스펙에 있으나 미구현 |
| **카드 그룹바이 팀** | `AgentCardGrid.tsx` | team_id별 섹션 분리 옵션 |
| **관계 그래프 팀 그룹핑** | `RelationshipGraph.tsx` | team_id별 점선 박스 그룹핑 미구현 |
| **빈상태/에러/스켈레톤** | 여러 컴포넌트 | 기본 빈 상태만 있고, 스켈레톤 로더/에러 오버레이 없음 |
| **테스트** | `__tests__/*.test.tsx` | 단위 테스트 전무 |

---

## 3. 핵심 아키텍처 이슈: N개 에이전트/팀 리포팅 구조

### 현재 문제

서버와 FE 모두 **다수의 독립적 에이전트 소스(Claude Code, OpenClaw 등)로부터 N개의 에이전트 또는 팀을 동시 관찰**하는 구조입니다. 하지만 현재 FE에는 이 "멀티-소스, 멀티-팀" 시나리오가 충분히 반영되어 있지 않습니다.

### 서버 측 (이미 지원됨)

서버는 이미 N개 에이전트/팀 구조를 지원합니다:

```
┌─ Collector A (Claude Code) ─────────────┐
│  ~/.claude/projects/repo-1/  → agent-1  │──┐
│  ~/.claude/projects/repo-2/  → agent-2  │──┤
│  ~/.claude/projects/repo-2/  → agent-3  │──┤  (같은 repo에 여러 에이전트)
└──────────────────────────────────────────┘  │
                                              ├──→ EventBus → StateManager → WebSocket → FE
┌─ Collector B (OpenClaw) ────────────────┐  │
│  ~/.openclaw/agents/team-alpha/ → agent-4│──┤
│  ~/.openclaw/agents/team-alpha/ → agent-5│──┤  (team-alpha 팀)
│  ~/.openclaw/agents/solo/      → agent-6│──┘  (팀 없는 독립 에이전트)
└──────────────────────────────────────────┘
```

- **StateManager**: `team_id`, `parent_agent_id`, `child_agent_ids` 필드로 에이전트 간 관계 추적
- **WebSocket**: `agent:state` 이벤트에 `team_id`, `source` 정보 포함
- **REST API**: `GET /api/v1/agents` 전체 목록 반환, 팀/소스별 필터링은 FE 담당

### FE 측 (보강 필요)

현재 FE가 멀티-에이전트/팀 시나리오에서 부족한 부분:

#### 3-1. ~~Activity Feed — 전체 이벤트 스트림 미수신~~ ✅ 해결됨

**서버 측에서 해결 완료** (`6daac67`).

Dashboard 뷰(`set_view('dashboard')`) 클라이언트에게는 **모든 이벤트를 1초 배치로 broadcast**합니다. FE에서는 별도 작업 없이 기존 `socket.on('event')` 리스너가 모든 이벤트를 수신합니다.

```
변경 후 동작:
  - dashboard 뷰: 모든 이벤트를 1초 배치로 수신 (Activity Feed용)
  - 비-dashboard 뷰: subscribe한 에이전트만 즉시 수신 (상세 패널용)
```

> **FE 작업 불필요** — 기본 뷰가 `dashboard`이므로 연결만 하면 Activity Feed에 이벤트가 표시됩니다.

#### 3-2. 팀 그룹핑 UI 부재

10개 이상의 에이전트가 2~3개 팀에 걸쳐 활동하는 시나리오에서:
- **AgentCardGrid**: 팀별 섹션 분리 없이 플랫하게 나열됨
- **RelationshipGraph**: `team_id`별 그룹 경계(점선 박스)가 없음
- **필터**: 팀 필터 UI가 없어 특정 팀만 볼 수 없음

#### 3-3. 에이전트 추가/제거 실시간 반영

- `agent:remove` → 카드 즉시 소멸 (fade-out 없음)
- 새 에이전트 `agent:state` → 카드 즉시 등장 (fade-in 없음)
- 대량 에이전트 동시 추가/제거 시 레이아웃 점프 발생 가능

#### 3-4. 소스별 에이전트 구분 강화

현재 소스 뱃지(`CC`, `OC`)는 있지만:
- 같은 소스 내 여러 에이전트 구분이 어려움 (이름만으로)
- 팀 소속 표시(team_id)가 카드에 없음
- 서브에이전트 관계가 카드에 표시되지 않음 (스펙에는 "부모 카드 하단에 작은 칩" 명시)

---

## 4. 다음 단계: 백엔드 연동 파이프라인

FE 팀이 다음으로 준비해야 할 **실제 데이터 연동** 관련 사항입니다.

### 4-1. 서버 실행 방법

```bash
# 1. 전체 빌드
pnpm build

# 2. 서버 시작 (기본 포트 3000)
pnpm start                # ← 루트 레벨 편의 스크립트 (v2 추가)
# 또는
pnpm --filter @agent-observatory/server start

# 환경변수:
#   PORT=3000 (기본)
#   CLAUDE_CODE_WATCH_PATHS=~/.claude/projects (기본)
#   OPENCLAW_WATCH_PATHS=~/.openclaw/agents (기본)
#   OBSERVATORY_DB_PATH=./observatory.db (v3, 미지정 시 in-memory — 재시작 시 데이터 유실)
#   OBSERVATORY_API_KEYS=key1,key2 (v3, HTTP Collector API key, 미지정 시 open access)

# 서버 시작 시 출력 예시:
# [server] Claude Code collector started (paths: ~/.claude/projects)
# [server] OpenClaw collector started (paths: ~/.openclaw/agents)
# [server] Agent Observatory server listening on port 3000
# [server] Active collectors: ClaudeCodeCollector, OpenClawCollector
```

### 4-2. 데이터 흐름 (Collector → Server → FE)

```
JSONL 파일 변경 감지 (chokidar)
  → Collector가 JSONL 파싱 + UAEP 정규화
  → eventBus.publish(uaepEvent)
  → StateManager.handleEvent() → AgentLiveState 갱신
  → WebSocket: 'agent:state' emit
  → FE: agentStore.setAgent()
  → 리렌더

동시에:
  → MetricsAggregator.handleEvent() → 1분 윈도우 집계
  → WebSocket: 'metrics:snapshot' emit (5초 간격)
  → FE: metricsStore.setSnapshot()

동시에:
  → HistoryStore.append() → SQLite events/sessions 테이블에 영속 저장 (v3)
  → REST API에서 히스토리 조회 가능
  → GET /api/v1/events/search로 FTS5 전문검색 가능 (v3)
```

### 4-3. WebSocket 이벤트 정리 (서버가 실제로 emit하는 것)

| 이벤트 | 빈도 | 데이터 | 수신 조건 |
|--------|------|--------|----------|
| `init` | 연결 시 1회 | `{ agents: AgentLiveState[], metrics: MetricsSnapshot }` | 무조건 |
| `agent:state` | 상태 변경 시 | `AgentLiveState` | dashboard: 1초 배치, pixel: 100ms, timeline: 즉시 |
| `agent:remove` | 세션 종료 시 | `{ agent_id: string }` | 무조건 (io.emit) |
| `metrics:snapshot` | 5초 간격 | `MetricsSnapshot` | 무조건 (io.emit) |
| `event` | 이벤트 발생 시 | `UAEPEvent` | **dashboard 뷰: 모든 이벤트 (1초 배치)**, 비-dashboard: subscribe한 에이전트만 즉시 |

> **v2 변경**: dashboard 뷰 클라이언트는 별도 subscribe 없이 **모든 이벤트**를 1초 배치로 수신합니다. `useActivityFeed`의 `socket.on('event')` 리스너가 그대로 동작합니다. 비-dashboard 뷰(timeline 등)에서 특정 에이전트 이벤트를 받으려면 `socket.emit('subscribe', agentId)`가 필요합니다.

### 4-4. REST API (구현 완료)

#### 코어 API (인증 불필요)

```
GET  /api/v1/agents              → { agents: AgentLiveState[], total: number }
GET  /api/v1/agents/:id          → { agent: AgentLiveState }
GET  /api/v1/agents/:id/events   → { events: UAEPEvent[], total, offset, limit }
                                    ?limit=50&offset=0&type=tool.start
GET  /api/v1/agents/hierarchy    → { hierarchy: AgentHierarchyNode[] }           ← v3 추가
GET  /api/v1/agents/by-team      → { teams: [{ team_id, agents: AgentLiveState[] }] }  ← v3 추가
GET  /api/v1/sessions            → { sessions: [...], total }
GET  /api/v1/sessions/:id        → { session_id, events, total }
GET  /api/v1/sessions/:id/replay → SessionReplayResponse                        ← v4 추가
                                    ?from=<ISO-8601>&to=<ISO-8601>  — 시간 범위 필터
                                    ?types=tool.start,tool.end       — 이벤트 타입 필터
                                    ?limit=100&offset=0              — 페이지네이션
GET  /api/v1/metrics/summary     → { metrics: MetricsSnapshot }
GET  /api/v1/metrics/timeseries  → { metric, from, data: [{ts,value},...] }
                                    ?metric=tokens_per_minute&from=30
                                    from > 60이면 SQLite 과거 데이터도 포함 (v3)
GET  /api/v1/events/search       → { query, events: UAEPEvent[], total }         ← v3 추가
                                    ?q=tool.start&limit=50&offset=0
                                    FTS5 전문검색 (type, agent_id, data 필드)
GET  /api/v1/config              → { config: { watch_paths, metrics_interval_ms, timeseries_retention_minutes } }
PUT  /api/v1/config              → 런타임 설정 변경
                                    Body: { watch_paths?: string[], metrics_interval_ms?: number, timeseries_retention_minutes?: number }
POST /api/v1/events              → 외부 이벤트 수신
POST /api/v1/events/batch        → 배치 수신
```

#### 비용/토큰 분석 API (v4 추가)

```
GET  /api/v1/analytics/cost          → CostAnalyticsResponse
                                        { time_range, total_cost_usd, total_tokens, total_sessions, cost_timeseries }
GET  /api/v1/analytics/cost/by-agent → CostByAgentResponse
                                        { time_range, agents: [{ agent_id, agent_name, source, total_cost_usd, total_tokens, session_count, cost_percentage }], total_cost_usd, total_tokens }
GET  /api/v1/analytics/cost/by-team  → CostByTeamResponse
                                        { time_range, teams: [{ team_id, total_cost_usd, total_tokens, agent_count, session_count, cost_percentage }], total_cost_usd, total_tokens }
GET  /api/v1/analytics/cost/by-tool  → CostByToolResponse
                                        { time_range, tools: [{ tool_category, call_count, estimated_cost_usd, cost_percentage }], total_cost_usd }
                                        ※ estimated_cost_usd는 비례 배분 (category_calls / total_calls * total_cost)
GET  /api/v1/analytics/tokens        → TokenAnalyticsResponse
                                        { time_range, total_tokens, tokens_timeseries, by_agent }

모든 analytics 엔드포인트 공통 쿼리:
  ?from=<ISO-8601>&to=<ISO-8601>  — 시간 범위 필터. 미지정 시 전체 기간.
```

#### OpenAPI 문서 (v4 추가)

```
GET  /api-docs/               → Swagger UI (브라우저에서 API 탐색/테스트)
GET  /api-docs/openapi.json   → OpenAPI 3.0.3 스펙 JSON
```

#### Agent SDK Hook Collector (v3 추가)

```
POST /api/v1/hooks/sdk           → Claude Code Hook payload → UAEP 변환
                                    Body: { hook_name, session_id, agent_id?, tool_name?, input?, output?, ... }
                                    hook_name 매핑:
                                      PreToolUse  → tool.start
                                      PostToolUse → tool.end
                                      Notification → agent.status
                                      Stop        → session.end
```

#### HTTP Collector (v3 추가, API key 인증)

```
POST   /api/v1/collector/sessions      → 세션 등록 → session.start 이벤트 생성
                                          Body: { agent_id, agent_name?, session_id?, source?, team_id? }
                                          Header: x-api-key (OBSERVATORY_API_KEYS 설정 시)
DELETE /api/v1/collector/sessions/:id  → 세션 종료 → session.end 이벤트 생성
POST   /api/v1/collector/events        → 단일 UAEP 이벤트 수집
POST   /api/v1/collector/events/batch  → 배치 수집
```

#### v3 신규 타입

```typescript
// packages/shared/src/types/agent.ts
export interface AgentHierarchyNode {
  agent: AgentLiveState;
  children: AgentHierarchyNode[];
}

// FE에서 hierarchy API 사용 예시:
// const { hierarchy } = await fetch('/api/v1/agents/hierarchy').then(r => r.json());
// hierarchy[0].agent.agent_id  → 루트 에이전트
// hierarchy[0].children[0].agent.agent_id → 자식 에이전트
```

#### v4 신규 타입 (Session Replay + Analytics)

```typescript
// packages/shared/src/types/api.ts — 모든 타입 @agent-observatory/shared에서 import 가능

// ─── Session Replay ───
export interface ReplayEvent {
  event: UAEPEvent;
  gap_ms: number;       // 이전 이벤트와의 간격 (ms)
  offset_ms: number;    // 세션 시작으로부터 경과 (ms)
}

export interface SessionReplaySummary {
  agent_id: string;
  agent_name: string;
  source: string;
  team_id?: string;
  start_time: string;
  end_time?: string;
  duration_ms: number;
  total_events: number;
  total_tokens: number;
  total_cost_usd: number;
  total_tool_calls: number;
  event_type_counts: Record<string, number>;
}

export interface SessionReplayResponse {
  session_id: string;
  summary: SessionReplaySummary;
  events: ReplayEvent[];
  total_events: number;
  time_range?: { from: string; to: string };  // from/to 쿼리 사용 시에만 존재
}

// ─── Cost/Token Analytics ───
export interface CostAnalyticsResponse {
  time_range: { from: string; to: string };
  total_cost_usd: number;
  total_tokens: number;
  total_sessions: number;
  cost_timeseries: { ts: string; cost: number; tokens: number }[];
}

export interface AgentCostEntry {
  agent_id: string;
  agent_name: string;
  source: string;
  total_cost_usd: number;
  total_tokens: number;
  session_count: number;
  cost_percentage: number;  // 전체 비용 대비 %, 합계 ~100
}

export interface CostByAgentResponse {
  time_range: { from: string; to: string };
  agents: AgentCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

export interface TeamCostEntry {
  team_id: string;
  total_cost_usd: number;
  total_tokens: number;
  agent_count: number;
  session_count: number;
  cost_percentage: number;
}

export interface CostByTeamResponse {
  time_range: { from: string; to: string };
  teams: TeamCostEntry[];
  total_cost_usd: number;
  total_tokens: number;
}

export interface ToolCostEntry {
  tool_category: string;       // 'file_read', 'command' 등
  call_count: number;
  estimated_cost_usd: number;  // 비례 배분 추정치
  cost_percentage: number;
}

export interface CostByToolResponse {
  time_range: { from: string; to: string };
  tools: ToolCostEntry[];
  total_cost_usd: number;
}

export interface TokenAnalyticsResponse {
  time_range: { from: string; to: string };
  total_tokens: number;
  tokens_timeseries: { ts: string; tokens: number }[];
  by_agent: { agent_id: string; agent_name: string; total_tokens: number }[];
}
```

**FE에서 사용 예시:**

```typescript
// 세션 재생 (Playback 컨트롤러)
const { summary, events } = await fetch('/api/v1/sessions/sess-1/replay').then(r => r.json());
// events[0].gap_ms → 0 (첫 번째 이벤트)
// events[1].gap_ms → 1000 (1초 후)
// events[1].offset_ms → 1000 (세션 시작 기준)
// summary.duration_ms → 전체 세션 길이
// summary.event_type_counts → { 'tool.start': 5, 'tool.end': 4, ... }

// 비용 대시보드 차트
const costData = await fetch('/api/v1/analytics/cost').then(r => r.json());
// costData.cost_timeseries → [{ ts: '...', cost: 0.05, tokens: 100 }, ...]
// costData.total_cost_usd → 전체 누적 비용

// 에이전트별 비용 파이차트
const byAgent = await fetch('/api/v1/analytics/cost/by-agent').then(r => r.json());
// byAgent.agents[0].cost_percentage → 45.2 (%)
```

### 4-5. Mock 모드에서 실서버 전환

```bash
# 현재 (Mock 모드)
VITE_MOCK=true pnpm --filter @agent-observatory/web dev

# 실서버 연동 (서버를 먼저 띄운 후)
pnpm --filter @agent-observatory/web dev
# VITE_WEBSOCKET_URL 기본값: http://localhost:3000
```

---

## 5. FE 팀 남은 작업 우선순위

### Phase A: 서버 연동 기반 (최우선)

1. ~~**Activity Feed 이벤트 수신 문제 해결**~~ ✅ 서버 측 해결 완료 — dashboard 뷰에서 모든 이벤트 자동 수신
2. **subscribe/unsubscribe 구현** — 카드 클릭 시 `socket.emit('subscribe', agentId)`, 패널 닫힘 시 `unsubscribe`. 비-dashboard 뷰(AgentDetailPanel 등)에서 특정 에이전트 이벤트 수신에 사용
3. **set_view 뷰 전환 연동** — 현재 connect 시 1회만 emit. 뷰 전환 탭 구현 시 재전송 필요
4. **에러 상태/재연결 UI** — 연결 끊김 시 반투명 오버레이, 자동 재연결 표시

### Phase B: 멀티 에이전트/팀 UX (v3 API 활용)

5. **팀 필터 UI** — `AgentCardFilters`에 team_id 기반 필터 버튼 추가. `GET /api/v1/agents/by-team`으로 팀 목록 조회 가능 (v3)
6. **카드 그룹바이 팀** — `AgentCardGrid`에 team_id별 섹션 분리 토글. 서버 측 그룹핑 API 활용 (v3)
7. **카드에 팀/서브에이전트 표시** — team_id 뱃지, 자식 에이전트 칩
8. **RelationshipGraph 팀 그룹핑** — `GET /api/v1/agents/hierarchy`로 트리 구조 직접 조회 (v3). CSS 트리 대신 API 트리 데이터 활용

### Phase C: 차트 분리 + 비용 분석 (v4 API 활용)

9. MetricsPanel 내 차트를 `charts/` 서브디렉토리로 분리
10. **CostChart** 추가 — `GET /api/v1/analytics/cost`의 `cost_timeseries` 데이터로 라인차트
11. **CostByAgentChart** 추가 — `GET /api/v1/analytics/cost/by-agent`로 에이전트별 비용 파이/바 차트
12. **CostByTeamChart** 추가 — `GET /api/v1/analytics/cost/by-team`으로 팀별 비용 비교
13. **CostByToolChart** 추가 — `GET /api/v1/analytics/cost/by-tool`로 도구 카테고리별 추정 비용
14. **TokensAnalyticsChart** 추가 — `GET /api/v1/analytics/tokens`의 시계열 + 에이전트별 분석
15. **ActiveAgentsChart** 추가 (활성 에이전트 에어리어 차트)
16. **ActivityFeedFilters** 추가 (에이전트별/타입별 필터 UI)

### Phase D: 세션 재생 + 상세 패널 (v4 API 활용)

17. **SessionListView** — `GET /api/v1/sessions`로 세션 히스토리 목록 UI
18. **SessionReplayView** — `GET /api/v1/sessions/:id/replay`로 세션 재생 UI
    - Playback 컨트롤 (재생/일시정지/속도 조절)
    - `gap_ms`를 활용한 실시간 타이밍 재현
    - `offset_ms`로 타임라인 시크바 구현
    - `summary.event_type_counts`로 이벤트 분포 미니맵
    - `from`/`to`/`types` 필터로 특정 구간/타입만 재생
19. **AgentDetailPanel** 사이드패널 구현 (에이전트 상세 + 이벤트 히스토리)
20. REST API 연동: `GET /api/v1/agents/:id/events` + `GET /api/v1/events/search?q=...` (v3 검색 API)
21. 카드 클릭 → 패널 열기/닫기 인터랙션
22. 관계 그래프 노드 클릭 → 카드 하이라이트 연동

### Phase E: 마무리

23. 카드/피드 등장/소멸 애니메이션
24. 스켈레톤 로더
25. 카드 정렬 모드 UI
26. Vitest + RTL 단위 테스트 작성

---

## 6. 참고: 백엔드 변경 파일 목록

### Phase 3 (v4) 변경

```
# shared 패키지 — FE에서 import 가능한 신규 타입
packages/shared/src/types/api.ts              — 12개 신규 타입 추가 (ReplayEvent, SessionReplaySummary,
                                                SessionReplayResponse, CostAnalyticsResponse, AgentCostEntry,
                                                CostByAgentResponse, TeamCostEntry, CostByTeamResponse,
                                                ToolCostEntry, CostByToolResponse, TokenAnalyticsResponse 등)
packages/shared/src/types/index.ts            — 신규 타입 re-export

# server 패키지
packages/server/src/core/history-store.ts     — 8개 쿼리 메서드 추가 (getSession, getSessionReplay,
                                                getCostSummary, getCostByAgent, getCostByTeam,
                                                getCostTimeseries, getToolCallDistribution, getTokensByAgent)
packages/server/src/delivery/api.ts           — GET /sessions/:id/replay 엔드포인트 추가
packages/server/src/delivery/api-analytics.ts — [신규] 5개 analytics 엔드포인트 (cost, cost/by-agent,
                                                cost/by-team, cost/by-tool, tokens)
packages/server/src/delivery/openapi.ts       — [신규] OpenAPI 3.0.3 스펙 생성 + Swagger UI 서빙
packages/server/src/delivery/openapi-schemas.ts — [신규] JSON Schema 정의
packages/server/src/app.ts                    — analytics + openapi 라우터 마운트
packages/server/package.json                  — swagger-jsdoc, swagger-ui-dist 의존성 추가

# 테스트
packages/server/src/__tests__/history-store-phase3.test.ts — [신규] HistoryStore 쿼리 메서드 15 tests
packages/server/src/__tests__/replay.test.ts               — [신규] 세션 재생 API 6 tests
packages/server/src/__tests__/api-analytics.test.ts        — [신규] 분석 API 12 tests
packages/server/src/__tests__/openapi.test.ts              — [신규] OpenAPI 문서 6 tests
```

### Phase 2 (v3) 변경

```
# shared 패키지
packages/shared/src/types/agent.ts            — AgentHierarchyNode 타입 추가
packages/shared/src/types/api.ts              — AgentHierarchyResponse, AgentsByTeamResponse, EventSearchResponse 추가

# server 패키지
packages/server/src/core/history-store.ts     — SQLite 전면 재작성 (better-sqlite3)
packages/server/src/core/metrics-aggregator.ts — SQLite 시계열 영속화 추가
packages/server/src/core/state-manager.ts     — getHierarchy(), getSubtree(), getTeams() 추가
packages/server/src/delivery/api.ts           — 3개 신규 엔드포인트 (hierarchy, by-team, search)
packages/server/src/app.ts                    — SQLite 초기화, close() 추가
packages/server/src/index.ts                  — SDK/HTTP Collector 마운트, 환경변수 추가

# collectors 패키지
packages/collectors/src/agent-sdk/index.ts    — Agent SDK Hook Collector 구현
packages/collectors/src/http/index.ts         — HTTP Collector 구현 (API key 인증)
```

---

## 7. 백엔드 테스트 현황

FE 연동 전에 백엔드가 정상인지 확인:

```bash
pnpm test          # 전체 255개 테스트 (v4: 216→255)
# shared:     35 tests (타입 유틸, 검증, UUID)
# collectors: 87 tests (CC/OC 파서·노멀라이저 + Agent SDK Collector + HTTP Collector)
# server:    133 tests (코어, API, WebSocket, E2E + 세션 재생 + 분석 API + OpenAPI)
```

**v4에서 추가된 테스트 범위 (+39 tests)**:
- HistoryStore Phase 3 쿼리: getSession, getSessionReplay (시간범위/타입 필터, 페이지네이션), getCostSummary, getCostByAgent (다중 에이전트 그룹핑), getCostByTeam (팀별 그룹핑, 팀 없는 에이전트 제외), getCostTimeseries (분 단위 버킷 집계), getToolCallDistribution, getTokensByAgent (15 tests)
- Session Replay API: 404 unknown session, 전체 이벤트 시간순, gap_ms/offset_ms 정확성, from/to 필터, types 필터, summary 필드 (6 tests)
- Analytics API: 각 5개 엔드포인트 기본 응답, 시간 범위 필터, 빈 DB 0값, cost_percentage 합계 ~100%, by-tool 비례 배분 (12 tests)
- OpenAPI: /api-docs/openapi.json → 200 + openapi 3.0.3, 모든 엔드포인트 paths 존재, Swagger UI 서빙 (6 tests)

**기존 테스트 (v3 이하)**:
- E2E 통합: CC/OC JSONL → 파서 → 노멀라이저 → EventBus → API/WebSocket (5 tests)
- HistoryStore SQLite: CRUD, FTS5 검색, 세션 테이블, 파일 영속화 (21 tests)
- MetricsAggregator: 시계열 영속/조회, 인메모리+SQLite 결합 (11 tests)
- StateManager 계층: getHierarchy, getSubtree, getTeams (21 tests)
- REST API 코어: agents, sessions, metrics, config, events (24 tests)
- WebSocket: init, agent:state, batch broadcast (6 tests)
- EventBus: publish/subscribe/filter (6 tests)

---

## 8. 커밋 히스토리 참조

```
(Phase 3 커밋 — v4)
f939d55 feat: implement Phase 2 backend — SQLite persistence, collectors, hierarchy API
28ce251 docs: update FE handoff document (v2)
65b85c0 server: add PUT /api/v1/config, E2E integration tests, and root scripts
6daac67 server: broadcast events to dashboard-view clients and fix CLI entry point
61ad1c0 docs: add FE team handoff document
558b4f2 web: align package structure with monorepo conventions  ← 정합성 수정
b24a624 Merge branch 'feat/dashboard'                          ← FE 병합
e873858 feat(dashboard): initialize React/Vite web application ← FE 초기 구현
85611bf feat: implement Phase 1 backend (shared, collectors, server)
6ad8960 chore: initial commit
```

### v4에서 추가된 백엔드 변경 요약 (Phase 3)

| 변경 영역 | 내용 | FE 영향 |
|-----------|------|---------|
| **세션 재생 API** | `GET /sessions/:id/replay` — gap_ms, offset_ms 포함 이벤트 시퀀스 | Playback UI 구현 가능. gap_ms로 실시간 타이밍 재현, offset_ms로 시크바 |
| **비용 분석 API** | `/analytics/cost`, `/cost/by-agent`, `/cost/by-team`, `/cost/by-tool` | 비용 대시보드 차트 5종 구현 가능 (시계열, 파이, 바차트) |
| **토큰 분석 API** | `/analytics/tokens` — 시계열 + 에이전트별 토큰 집계 | 토큰 사용량 모니터링 차트 |
| **OpenAPI 문서** | `/api-docs/` → Swagger UI 자동 생성 | 개발 중 API 탐색/테스트 도구, FE 코드 변경 불필요 |
| **신규 타입 12개** | `shared` 패키지에 Replay + Analytics 응답 타입 추가 | `@agent-observatory/shared`에서 import 가능 |

### v3 백엔드 변경 요약 (Phase 2)

| 변경 영역 | 내용 | FE 영향 |
|-----------|------|---------|
| **SQLite 영속화** | HistoryStore + MetricsAggregator가 SQLite에 데이터 저장 | 서버 재시작 후에도 조회 가능. FE 코드 변경 불필요 |
| **계층 API** | `GET /api/v1/agents/hierarchy` — 부모-자식 에이전트 트리 반환 | RelationshipGraph에서 활용 가능 |
| **팀 API** | `GET /api/v1/agents/by-team` — team_id별 에이전트 그룹 반환 | 팀 필터/그룹바이 구현 시 활용 |
| **이벤트 검색** | `GET /api/v1/events/search?q=...` — FTS5 전문검색 | AgentDetailPanel 검색 기능에 활용 |
| **Agent SDK/HTTP Collector** | 서버가 자동으로 UAEP 변환 후 WebSocket emit | FE 변경 불필요 |
