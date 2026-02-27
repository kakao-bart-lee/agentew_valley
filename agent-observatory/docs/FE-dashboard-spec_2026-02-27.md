# Agent Observatory — FE Dashboard 구현 계획서

> FE 에이전트 팀 전달용 독립 문서
> 본 문서만으로 대시보드 뷰를 구현할 수 있도록 설계되었습니다.

**작성일**: 2026-02-27
**버전**: v1.0
**상위 문서**: `agent-observatory-architecture_2026-02-27.md`
**대상 독자**: 대시보드 FE 구현 담당 에이전트/팀

---

## 1. 문서 목적 및 범위

### 1.1 이 문서의 역할

Agent Observatory 프로젝트의 **대시보드 뷰(Dashboard View)**를 FE 팀이 독립적으로 구현할 수 있도록 필요한 모든 정보를 담은 계획서입니다.

### 1.2 FE 팀의 책임 범위

```
담당 영역:
  ✅ views/Dashboard/ 하위 모든 컴포넌트
  ✅ 대시보드에서 사용하는 차트/시각화 컴포넌트
  ✅ 대시보드 반응형 레이아웃
  ✅ 대시보드 관련 Storybook/테스트

담당하지 않는 영역:
  ❌ 픽셀 오피스 뷰 (views/PixelOffice/) — 별도 팀
  ❌ 타임라인 뷰 (views/Timeline/) — Phase 2
  ❌ 백엔드 서버/Collector — 백엔드 팀
  ❌ Zustand 스토어 코어 로직 — 공통 (협의 필요)
  ❌ WebSocket 연결 훅 — 공통 (협의 필요)
```

### 1.3 의존하는 공유 자산 (다른 팀이 제공)

```
packages/shared/
  └── src/types/
      ├── uaep.ts      — UAEP 이벤트 타입 (UAEPEvent, UAEPEventType 등)
      ├── agent.ts      — AgentLiveState 타입
      ├── metrics.ts    — 메트릭 타입
      └── api.ts        — REST API 요청/응답 타입

packages/web/src/
  ├── stores/
  │   ├── agentStore.ts   — 에이전트 상태 (Zustand)
  │   └── metricsStore.ts — 메트릭 상태 (Zustand)
  ├── hooks/
  │   ├── useSocket.ts    — Socket.IO 연결 관리
  │   ├── useAgents.ts    — 에이전트 상태 구독
  │   └── useMetrics.ts   — 메트릭 구독
  └── components/
      ├── AppShell.tsx     — 앱 전체 레이아웃 (뷰 전환 탭 포함)
      └── AgentDetailPanel.tsx — 에이전트 상세 사이드패널 (공용)
```

---

## 2. 데이터 계약 (Data Contract)

FE 팀이 소비하는 데이터의 정확한 형태를 정의합니다.

### 2.1 AgentLiveState (에이전트 실시간 상태)

Zustand 스토어(`agentStore`)에서 `agents: Map<string, AgentLiveState>`로 제공됩니다. WebSocket을 통해 실시간 갱신됩니다.

```typescript
interface AgentLiveState {
  // === 식별 ===
  agent_id: string;
  agent_name: string;                // 표시 이름 ("Claude Code #1")
  source: AgentSourceType;           // "claude_code" | "openclaw" | "agent_sdk" | "custom"
  team_id?: string;                  // 스웜/팀 그룹 ID

  // === 현재 상태 ===
  status: AgentStatus;
  current_tool?: string;             // "Read", "Bash" 등 (acting 상태일 때)
  current_tool_category?: ToolCategory;
  status_detail?: string;            // "Reading: src/main.ts" (선택적 설명)
  last_activity: string;             // ISO-8601 타임스탬프

  // === 세션 정보 ===
  session_id: string;
  session_start: string;             // ISO-8601

  // === 누적 메트릭 ===
  total_tokens: number;
  total_cost_usd: number;
  total_tool_calls: number;
  total_errors: number;
  tool_distribution: Record<ToolCategory, number>;  // 카테고리별 호출 수

  // === 서브에이전트 관계 ===
  parent_agent_id?: string;          // null이면 최상위 에이전트
  child_agent_ids: string[];         // 현재 활성 서브에이전트 ID 목록
}

type AgentStatus =
  | 'idle'                 // 대기 (세션 열려있으나 비활성)
  | 'thinking'             // LLM 사고 중
  | 'acting'               // 도구 실행 중
  | 'waiting_input'        // 사용자 입력 대기
  | 'waiting_permission'   // 권한 승인 대기
  | 'error';               // 에러 발생

type ToolCategory =
  | 'file_read'       // Read, Glob, Grep
  | 'file_write'      // Write, Edit, NotebookEdit
  | 'command'         // Bash
  | 'search'          // WebSearch
  | 'web'             // WebFetch, Browser
  | 'planning'        // EnterPlanMode
  | 'thinking'        // LLM reasoning
  | 'communication'   // AskUserQuestion, Task
  | 'other';

type AgentSourceType =
  | 'claude_code'
  | 'openclaw'
  | 'agent_sdk'
  | 'langchain'
  | 'crewai'
  | 'custom';
```

### 2.2 WebSocket 이벤트 (Socket.IO)

대시보드가 수신하는 이벤트:

```typescript
// 서버 → 클라이언트

// 에이전트 상태 변경 (개별)
socket.on('agent:state', (state: AgentLiveState) => void);

// 에이전트 제거 (세션 종료)
socket.on('agent:remove', (data: { agent_id: string }) => void);

// 실시간 이벤트 (Activity Feed용)
socket.on('event', (event: UAEPEvent) => void);

// 집계 메트릭 스냅샷 (5초 간격)
socket.on('metrics:snapshot', (metrics: MetricsSnapshot) => void);

// 초기 상태 (연결 시 전체 스냅샷)
socket.on('init', (data: {
  agents: AgentLiveState[];
  metrics: MetricsSnapshot;
}) => void);
```

```typescript
// 클라이언트 → 서버

// 뷰 전환 알림 (서버 최적화용) — raw string, 객체가 아님
socket.emit('set_view', 'dashboard' | 'pixel' | 'timeline');

// 특정 에이전트 상세 구독 — raw string (agent_id), 객체가 아님
socket.emit('subscribe', agentId: string);
socket.emit('unsubscribe', agentId: string);
```

### 2.3 MetricsSnapshot (집계 메트릭)

```typescript
interface MetricsSnapshot {
  timestamp: string;                    // ISO-8601

  // 전체 집계
  active_agents: number;
  total_agents: number;                 // 세션 열려있는 전체
  total_tokens_per_minute: number;
  total_cost_per_hour: number;
  total_errors_last_hour: number;
  total_tool_calls_per_minute: number;

  // 카테고리별 도구 분포 (전체 합산)
  tool_distribution: Record<ToolCategory, number>;

  // 소스별 에이전트 수
  source_distribution: Record<AgentSourceType, number>;

  // 시계열 (최근 60분, 1분 단위)
  timeseries: {
    timestamps: string[];              // 60개 ISO-8601
    tokens_per_minute: number[];       // 60개
    cost_per_minute: number[];         // 60개
    active_agents: number[];           // 60개
    tool_calls_per_minute: number[];   // 60개
    error_count: number[];             // 60개
  };
}
```

### 2.4 REST API (초기 로딩 / 히스토리 조회)

```
GET /api/v1/agents
  Response: { agents: AgentLiveState[], total: number }

GET /api/v1/agents/:id
  Response: { agent: AgentLiveState }

GET /api/v1/agents/:id/events?limit=50&offset=0&type=tool.start
  Response: { events: UAEPEvent[], total: number, offset: number, limit: number }

GET /api/v1/agents/hierarchy
  Response: { hierarchy: AgentHierarchyNode[] }

GET /api/v1/agents/by-team
  Response: { teams: [{ team_id, agents: AgentLiveState[] }] }

GET /api/v1/metrics/summary
  Response: { metrics: MetricsSnapshot }

GET /api/v1/metrics/timeseries?metric=tokens_per_minute&from=60
  Response: { metric, from, data: [{ ts, value }] }

GET /api/v1/sessions
  Response: { sessions: SessionSummary[], total }

GET /api/v1/sessions/:id
  Response: { session_id, events: UAEPEvent[], total }

GET /api/v1/sessions/:id/replay?from=&to=&types=&limit=&offset=
  Response: SessionReplayResponse (v4)

GET /api/v1/events/search?q=...&limit=50&offset=0
  Response: { query, events: UAEPEvent[], total }

GET /api/v1/analytics/cost?from=&to=
  Response: CostAnalyticsResponse (v4)

GET /api/v1/analytics/cost/by-agent?from=&to=
  Response: CostByAgentResponse (v4)

GET /api/v1/analytics/cost/by-team?from=&to=
  Response: CostByTeamResponse (v4)

GET /api/v1/analytics/cost/by-tool?from=&to=
  Response: CostByToolResponse (v4)

GET /api/v1/analytics/tokens?from=&to=
  Response: TokenAnalyticsResponse (v4)

GET /api/v1/config
  Response: { config: { watch_paths, metrics_interval_ms, timeseries_retention_minutes } }

GET /api-docs/
  → Swagger UI (API 탐색/테스트) (v4)

GET /api-docs/openapi.json
  → OpenAPI 3.0.3 스펙 JSON (v4)
```

---

## 3. 대시보드 레이아웃 설계

### 3.1 전체 레이아웃 구조

```
┌─────────────────────────────────────────────────────────────────┐
│ AppShell (공통)                                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ [Dashboard●] [Pixel Office] [Timeline]    🔌2 agents  ⚙️  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌────────────────────────────────────────────────── ─ ─ ─ ─ ┐  │
│ │ DashboardView (이 문서의 구현 범위)               Detail │  │
│ │                                                   Panel │  │
│ │  ┌─ A: Status Bar ─────────────────────────────┐  (선택)│  │
│ │  │ Active: 3  │  Tokens/min: 1.2k  │  $0.42/hr│       │  │
│ │  └─────────────────────────────────────────────┘       │  │
│ │                                                         │  │
│ │  ┌─ B: Agent Cards ────────────────────────────┐       │  │
│ │  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐│       │  │
│ │  │ │Agent 1 │ │Agent 2 │ │Agent 3 │ │Agent 4 ││       │  │
│ │  │ │●Active │ │○Idle   │ │◐Think  │ │⚠Error  ││       │  │
│ │  │ │Bash    │ │        │ │LLM..   │ │timeout ││       │  │
│ │  │ │12.3k⊘  │ │ 8.1k⊘  │ │ 5.2k⊘  │ │ 1.1k⊘  ││       │  │
│ │  │ │$0.18   │ │$0.12   │ │$0.08   │ │$0.04   ││       │  │
│ │  │ └────────┘ └────────┘ └────────┘ └────────┘│       │  │
│ │  └─────────────────────────────────────────────┘       │  │
│ │                                                         │  │
│ │  ┌─ C: Metrics ──────────┬─ D: Activity Feed ─────────┐│  │
│ │  │                       │                             ││  │
│ │  │ [Tokens/min chart]    │ 10:31:02 Agent1 → Read     ││  │
│ │  │ [Cost/hr chart]       │   src/auth/login.ts        ││  │
│ │  │                       │ 10:31:01 Agent3 → LLM      ││  │
│ │  │ [Tool Distribution]   │   thinking...              ││  │
│ │  │  file_read  ████ 34%  │ 10:30:58 Agent1 → Write    ││  │
│ │  │  file_write ██ 18%    │   src/auth/login.ts        ││  │
│ │  │  command    █████ 41% │ 10:30:55 Agent2 → Bash     ││  │
│ │  │  search     █ 7%      │   npm test                 ││  │
│ │  │                       │ 10:30:50 Agent1 → Edit     ││  │
│ │  │ [Source Distribution] │   src/utils/auth.ts        ││  │
│ │  │  claude_code: 3       │         ...                ││  │
│ │  │  openclaw: 1          │                             ││  │
│ │  └───────────────────────┴─────────────────────────────┘│  │
│ │                                                         │  │
│ │  ┌─ E: Agent Relationship Graph ───────────────────────┐│  │
│ │  │        [Main Agent 1]                                ││  │
│ │  │        /     |     \                                ││  │
│ │  │   [Sub A]  [Sub B]  [Sub C]                         ││  │
│ │  │                                                      ││  │
│ │  │  [Main Agent 2] (독립)                               ││  │
│ │  │                                                      ││  │
│ │  │  ── team-alpha ──    ── (ungrouped) ──              ││  │
│ │  └─────────────────────────────────────────────────────┘│  │
│ │                                                         │  │
│ └─────────────────────────────────────────────── ─ ─ ─ ─ ┘  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 섹션별 상세 설계

#### A. Status Bar (글로벌 요약)

```
위치: 대시보드 최상단 (항상 표시)
데이터 소스: MetricsSnapshot

표시 항목:
  - Active Agents: {active_agents} / {total_agents}
  - Tokens/min: {total_tokens_per_minute} (포맷: 1.2k)
  - Cost/hr: ${total_cost_per_hour} (포맷: $0.42)
  - Errors: {total_errors_last_hour} (0이면 녹색, 1+이면 주황/빨강)
  - 연결 상태: 🟢 Connected / 🔴 Disconnected / 🟡 Reconnecting

동작:
  - 5초마다 metrics:snapshot으로 갱신
  - 연결 끊김 시 "Reconnecting..." 표시 + 자동 재연결
```

#### B. Agent Cards (에이전트 카드 그리드)

```
데이터 소스: agentStore.agents (Map<string, AgentLiveState>)

카드 구성:
  ┌──────────────────────────────┐
  │ [소스아이콘] Agent Name   [●]│  ← 상태 표시등
  │                              │
  │  Status: Acting              │
  │  Tool:   Bash (command)      │
  │  Detail: npm run test        │
  │                              │
  │  Tokens: 12.3k    Cost: $0.18│
  │  Tools:  47        Errors: 0 │
  │                              │
  │  Session: 15m ago            │
  │  [▒▒▒▒▒▒▒▒▒▒] 도구분포 미니바│
  └──────────────────────────────┘

상태별 표시등 색상:
  idle              → ⚪ 회색
  thinking          → 🟡 노랑 (깜빡임)
  acting            → 🟢 녹색
  waiting_input     → 🔵 파랑
  waiting_permission→ 🟠 주황
  error             → 🔴 빨강

소스 아이콘:
  claude_code → CC 뱃지
  openclaw    → OC 뱃지
  agent_sdk   → SDK 뱃지
  custom      → ⚙️

카드 인터랙션:
  - 클릭 → AgentDetailPanel 열기 (사이드패널, 공통 컴포넌트)
  - 호버 → 도구 분포 툴팁 확대
  - 서브에이전트 표시: 부모 카드 하단에 작은 칩으로 자식 에이전트 목록

카드 정렬:
  - 기본: 상태 우선순위 (error > waiting > acting > thinking > idle)
  - 같은 상태 내: last_activity 최신순
  - 팀별 그룹핑 옵션 (team_id별 섹션 분리)

필터링:
  - 소스 필터: [All] [Claude Code] [OpenClaw] [Agent SDK] [Custom]
  - 상태 필터: [All] [Active] [Idle] [Error]
  - 팀 필터: team_id별 체크박스

레이아웃:
  - 반응형 그리드: min-width 280px per card, auto-fill
  - 에이전트 1-4개: 1행
  - 에이전트 5-8개: 2행
  - 에이전트 9+: 스크롤 or 축소 모드
```

#### C. Metrics Panel (메트릭 패널)

```
데이터 소스: MetricsSnapshot (timeseries 포함)

차트 1: Tokens per Minute (라인 차트)
  - X축: 최근 60분 (1분 간격)
  - Y축: tokens_per_minute
  - 라이브러리: Recharts <LineChart>
  - 실시간: 1초마다 최신 포인트 갱신

차트 2: Cost per Hour (라인 차트)
  - X축: 최근 60분
  - Y축: cost_per_minute × 60
  - 색상: 임계치 초과 시 빨간색

차트 3: Tool Category Distribution (수평 바 차트)
  - 카테고리별 비율 (전체 합산)
  - 색상 팔레트:
      file_read     → #3b82f6 (blue)
      file_write    → #10b981 (green)
      command       → #f59e0b (amber)
      search        → #8b5cf6 (purple)
      web           → #06b6d4 (cyan)
      planning      → #ec4899 (pink)
      thinking      → #6366f1 (indigo)
      communication → #f97316 (orange)
      other         → #9ca3af (gray)
  - 라이브러리: Recharts <BarChart> horizontal

차트 4: Source Distribution (도넛 차트, 작은 크기)
  - 에이전트 소스별 개수
  - 라이브러리: Recharts <PieChart>

차트 5: Active Agents over Time (에어리어 차트, 선택적)
  - X축: 최근 60분
  - Y축: active_agents
```

#### D. Activity Feed (활동 피드)

```
데이터 소스: socket.on('event') — 실시간 UAEPEvent 스트림

표시 형태:
  각 이벤트 → 한 줄 카드:
  ┌──────────────────────────────────────────────┐
  │ 10:31:02  [CC] Agent 1  → Read (file_read)   │
  │           src/auth/login.ts                   │
  └──────────────────────────────────────────────┘

구성 요소:
  - 타임스탬프 (HH:mm:ss)
  - 소스 뱃지 [CC] [OC] [SDK]
  - 에이전트 이름
  - 이벤트 타입 아이콘 + 도구명 + 카테고리
  - 상세 정보 (tool_input_summary 또는 status_detail)

이벤트 타입별 표시:
  tool.start        → "→ {tool_name} ({category})" + summary
  tool.end          → "✓ {tool_name}" + duration + success/fail
  tool.error        → "✗ {tool_name}" + error message (빨간색)
  agent.status      → 상태 변경 아이콘 + 상태명
  user.input        → "💬 User input" + summary
  user.permission   → "🔐 Permission requested"
  subagent.spawn    → "🔀 Spawned: {child_name}" + task description
  subagent.end      → "🔀 Completed: {child_name}"
  session.start     → "▶ Session started"
  session.end       → "⏹ Session ended"

기능:
  - 자동 스크롤 (최신이 위, 새 이벤트 추가 시 위로 push)
  - Pause 버튼 (스크롤 멈추고 과거 이벤트 확인)
  - 에이전트별 필터 (특정 agent_id만)
  - 이벤트 타입 필터 (tool만, status만 등)
  - 최대 200개 유지 (오래된 것 자동 제거)
  - 이벤트 클릭 → 상세 정보 팝오버
```

#### E. Agent Relationship Graph (에이전트 관계 그래프)

```
데이터 소스: AgentLiveState의 parent_agent_id / child_agent_ids

표시:
  - 트리 형태 (부모 → 자식 에이전트)
  - team_id로 그룹핑 (팀별 박스)
  - 독립 에이전트는 별도 영역

노드 표시:
  - 에이전트 이름 + 상태 색상 (상태 표시등과 동일)
  - 현재 도구명 (acting 상태일 때)

엣지 표시:
  - 부모 → 자식 연결선 (실선)
  - 팀 그룹 경계 (점선 박스)

인터랙션:
  - 노드 클릭 → 해당 에이전트 카드 하이라이트 + 상세 패널
  - 호버 → 에이전트 요약 툴팁

구현 방식:
  - 에이전트 5개 이하: 단순 CSS flexbox 트리
  - 에이전트 6개 이상: 라이브러리 사용 (react-flow 또는 d3-hierarchy)
  - 에이전트 0개: "No active agents" 메시지 표시

접기/펼치기:
  - 기본: 펼침
  - 에이전트 많을 때: 접을 수 있음 (토글)
```

---

## 4. 컴포넌트 구조 및 파일맵

```
packages/web/src/views/Dashboard/
├── DashboardView.tsx           # 대시보드 메인 뷰 (레이아웃 조합)
├── StatusBar.tsx                # A: 글로벌 요약 바
├── AgentCardGrid.tsx            # B: 에이전트 카드 그리드 (필터 + 정렬 포함)
├── AgentCard.tsx                # B: 개별 에이전트 카드
├── AgentCardFilters.tsx         # B: 필터 UI (소스/상태/팀)
├── MetricsPanel.tsx             # C: 메트릭 패널 (차트 모음)
├── charts/
│   ├── TokensChart.tsx          # C: 토큰/분 라인 차트
│   ├── CostChart.tsx            # C: 비용/시간 라인 차트
│   ├── ToolDistribution.tsx     # C: 도구 카테고리 바 차트
│   ├── SourceDistribution.tsx   # C: 소스 분포 도넛 차트
│   └── ActiveAgentsChart.tsx    # C: 활성 에이전트 에어리어 차트
├── ActivityFeed.tsx             # D: 활동 피드
├── ActivityFeedItem.tsx         # D: 피드 개별 항목
├── ActivityFeedFilters.tsx      # D: 피드 필터 (에이전트/타입)
├── RelationshipGraph.tsx        # E: 에이전트 관계 그래프
├── hooks/
│   ├── useDashboardMetrics.ts   # 대시보드 전용 메트릭 훅
│   ├── useActivityFeed.ts       # 이벤트 버퍼 + 필터 관리
│   └── useAgentFilters.ts       # 필터 상태 관리
├── utils/
│   ├── formatters.ts            # 숫자/시간/비용 포매터
│   ├── colors.ts                # 상태별/카테고리별 색상 맵
│   └── sorting.ts              # 에이전트 카드 정렬 로직
└── __tests__/
    ├── AgentCard.test.tsx
    ├── ActivityFeed.test.tsx
    └── MetricsPanel.test.tsx
```

---

## 5. 기술 스택 및 라이브러리

```
┌──────────────┬──────────────────────────────────────────┐
│ 영역          │ 기술                                      │
├──────────────┼──────────────────────────────────────────┤
│ UI 프레임워크 │ React 19 + TypeScript                    │
│ 빌드          │ Vite                                     │
│ 상태관리      │ Zustand (공통 스토어 소비)                 │
│ 스타일링      │ Tailwind CSS                             │
│ 차트          │ Recharts (LineChart, BarChart, PieChart)  │
│ 관계 그래프   │ CSS flexbox (소규모) / react-flow (대규모) │
│ 실시간        │ Socket.IO Client (공통 훅 소비)            │
│ 날짜/시간     │ date-fns                                  │
│ 테스트        │ Vitest + React Testing Library             │
│ 아이콘        │ Lucide React                              │
└──────────────┴──────────────────────────────────────────┘
```

---

## 6. 상태 관리 패턴

### 6.1 공통 스토어 소비 (읽기 전용)

```typescript
// agentStore에서 읽기
import { useAgentStore } from '@/stores/agentStore';

function DashboardView() {
  // 전체 에이전트 맵
  const agents = useAgentStore(s => s.agents);
  // 선택된 에이전트
  const selectedId = useAgentStore(s => s.selectedAgentId);
  // 필터 상태
  const sourceFilter = useAgentStore(s => s.sourceFilter);

  // 파생 데이터는 useMemo로 계산
  const activeAgents = useMemo(
    () => [...agents.values()].filter(a => a.status !== 'idle'),
    [agents]
  );
}
```

### 6.2 대시보드 로컬 상태

```typescript
// 대시보드 전용 상태 (Zustand 또는 useState)
// — 공통 스토어에 넣지 않음 (대시보드에서만 쓰는 UI 상태)

interface DashboardLocalState {
  // Activity Feed
  feedPaused: boolean;
  feedEvents: UAEPEvent[];         // 최대 200개 버퍼
  feedAgentFilter: string | null;  // 특정 agent_id or null(전체)
  feedTypeFilter: UAEPEventType[];

  // Agent Cards
  cardSortMode: 'status' | 'name' | 'activity' | 'cost';
  cardGroupByTeam: boolean;

  // Metrics Panel
  metricsTimeRange: '15m' | '30m' | '1h';

  // Relationship Graph
  graphCollapsed: boolean;
}
```

---

## 7. 인터랙션 흐름

### 7.1 초기 로딩

```
1. DashboardView 마운트
2. useSocket 훅이 Socket.IO 연결 확인 (이미 연결되어 있으면 스킵)
3. socket.emit('set_view', 'dashboard') → 서버에 최적화 힌트
4. socket.on('init') → agentStore에 초기 상태 세팅
5. MetricsSnapshot 수신 → metricsStore 초기화
6. 렌더링 시작
```

### 7.2 실시간 갱신 루프

```
매 이벤트:
  socket.on('agent:state')     → agentStore.setAgent() → AgentCard 리렌더
  socket.on('event')           → useActivityFeed 버퍼에 추가 → ActivityFeed 리렌더

매 5초:
  socket.on('metrics:snapshot') → metricsStore 갱신 → 차트 리렌더

매 5초:
  비활성 에이전트 감지 (last_activity 기준) → 상태 표시등 dim 처리
```

### 7.3 에이전트 카드 클릭

```
1. AgentCard 클릭
2. agentStore.selectAgent(agent_id)
3. AgentDetailPanel (공통 사이드패널) 열림
4. socket.emit('subscribe', agent_id) → 상세 이벤트 구독 (raw string)
5. 패널에 에이전트 상세 정보 + 최근 이벤트 히스토리 표시
6. REST API: GET /api/v1/agents/{id}/events → 과거 이벤트 로딩
7. 패널 닫힘 시: socket.emit('unsubscribe', agent_id) (raw string)
```

---

## 8. 반응형 설계

```
브레이크포인트:

Desktop (≥1280px):
  ┌────────────┬────────────┐
  │ Agent Cards │ Agent Cards│  ← 4열 그리드
  ├────────────┼────────────┤
  │ Metrics    │Activity Feed│  ← 좌우 2분할
  ├────────────┴────────────┤
  │ Relationship Graph       │
  └──────────────────────────┘

Tablet (768px-1279px):
  ┌──────────────────────────┐
  │ Agent Cards               │  ← 2열 그리드
  ├──────────────────────────┤
  │ Metrics                   │  ← 풀 너비
  ├──────────────────────────┤
  │ Activity Feed             │  ← 풀 너비
  ├──────────────────────────┤
  │ Relationship Graph        │
  └──────────────────────────┘

Mobile (< 768px):
  ┌──────────────────────────┐
  │ Status Bar (축소)         │
  ├──────────────────────────┤
  │ Agent Cards (1열, 스와이프)│
  ├──────────────────────────┤
  │ Activity Feed             │
  ├──────────────────────────┤
  │ Metrics (차트 축소)        │
  └──────────────────────────┘
  ※ Relationship Graph는 모바일에서 숨김 처리
```

---

## 9. 디자인 가이드

### 9.1 색상 시스템

```
배경:
  --bg-primary:    #0f172a (slate-900)   — 메인 배경 (다크 모드 기본)
  --bg-secondary:  #1e293b (slate-800)   — 카드/패널 배경
  --bg-tertiary:   #334155 (slate-700)   — 호버/선택 배경

텍스트:
  --text-primary:   #f8fafc (slate-50)
  --text-secondary: #94a3b8 (slate-400)
  --text-muted:     #64748b (slate-500)

상태 색상:
  idle:              #9ca3af (gray-400)
  thinking:          #fbbf24 (amber-400) + pulse 애니메이션
  acting:            #34d399 (emerald-400)
  waiting_input:     #60a5fa (blue-400)
  waiting_permission:#fb923c (orange-400)
  error:             #f87171 (red-400) + pulse 애니메이션

도구 카테고리 색상: (§3.2 C절 참조)

소스 색상:
  claude_code:  #f97316 (orange)
  openclaw:     #8b5cf6 (purple)
  agent_sdk:    #06b6d4 (cyan)
  custom:       #9ca3af (gray)
```

### 9.2 애니메이션

```
상태 전환: transition-all duration-300 ease-in-out
상태 표시등 깜빡임: animate-pulse (thinking, error)
새 이벤트 하이라이트: 0.5초 배경색 fade
카드 등장: fade-in + slide-up (150ms)
카드 제거: fade-out (150ms)
차트 갱신: smooth transition (Recharts animationDuration=300)
```

### 9.3 빈 상태 / 에러 상태

```
에이전트 없음:
  "No active agents detected"
  "Watching: ~/.claude/projects/, ~/.openclaw/agents/"
  [Configure Watch Paths] 버튼

연결 끊김:
  Status Bar 빨간색 + "Disconnected — Reconnecting..."
  카드 그리드 위에 반투명 오버레이

데이터 로딩 중:
  카드 → 스켈레톤 로더 (3개)
  차트 → 빈 축 + 로딩 스피너

에러:
  카드 내 에러 아이콘 + 마지막 에러 메시지 1줄
```

---

## 10. 구현 태스크 (FE 팀 체크리스트)

### Phase 1-A: 기반 (Week 2 Day 1-2)

```
□ DashboardView.tsx 레이아웃 스캐폴딩
□ StatusBar.tsx (메트릭 요약, 연결 상태)
□ AgentCard.tsx (정적 디자인, 모든 상태 표시)
□ AgentCardGrid.tsx (그리드 레이아웃, 반응형)
□ colors.ts + formatters.ts 유틸
□ Tailwind 다크 모드 색상 시스템 설정
```

### Phase 1-B: 실시간 연동 (Week 2 Day 3-4)

```
□ useAgents 훅 연결 → AgentCard 실시간 갱신 확인
□ useDashboardMetrics 훅 → MetricsSnapshot 소비
□ ActivityFeed.tsx (이벤트 수신 + 표시)
□ ActivityFeedItem.tsx (이벤트 타입별 렌더링)
□ useActivityFeed.ts (200개 버퍼, pause 기능)
□ StatusBar 실시간 갱신
```

### Phase 1-C: 차트 + 필터 (Week 2 Day 5 ~ Week 3 Day 1)

```
□ TokensChart.tsx (Recharts 라인 차트)
□ CostChart.tsx
□ ToolDistribution.tsx (수평 바 차트)
□ SourceDistribution.tsx (도넛 차트)
□ MetricsPanel.tsx (차트 조합)
□ AgentCardFilters.tsx (소스/상태/팀 필터)
□ ActivityFeedFilters.tsx (에이전트/타입 필터)
□ 카드 정렬 기능 (sorting.ts)
```

### Phase 1-D: 관계 그래프 + 마무리 (Week 3 Day 2-3)

```
□ RelationshipGraph.tsx (트리 형태)
□ 팀별 그룹핑 (team_id 박스)
□ 에이전트 카드 ↔ 관계 그래프 연동 (클릭 하이라이트)
□ 빈 상태 / 에러 상태 UI
□ 반응형 테스트 (Desktop / Tablet / Mobile)
□ Vitest 단위 테스트 (AgentCard, ActivityFeed, MetricsPanel)
```

총 예상: **7-8 작업일** (1인 FE 기준)

---

## 11. 테스트 전략

### 11.1 단위 테스트 (Vitest + RTL)

```typescript
// AgentCard.test.tsx 예시
describe('AgentCard', () => {
  it('shows correct status indicator for each status', () => {
    // idle → gray, acting → green, error → red ...
  });

  it('displays tool name and category when acting', () => {
    const agent = mockAgent({ status: 'acting', current_tool: 'Bash', current_tool_category: 'command' });
    render(<AgentCard agent={agent} />);
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('command')).toBeInTheDocument();
  });

  it('formats large token counts correctly', () => {
    const agent = mockAgent({ total_tokens: 12345 });
    render(<AgentCard agent={agent} />);
    expect(screen.getByText('12.3k')).toBeInTheDocument();
  });
});
```

### 11.2 Mock 데이터

```typescript
// tests/mocks/agents.ts
export const mockAgents: AgentLiveState[] = [
  {
    agent_id: 'cc-1', agent_name: 'Claude Code #1',
    source: 'claude_code', status: 'acting',
    current_tool: 'Bash', current_tool_category: 'command',
    total_tokens: 12345, total_cost_usd: 0.18,
    total_tool_calls: 47, total_errors: 0,
    // ...
  },
  {
    agent_id: 'oc-1', agent_name: 'OpenClaw Research',
    source: 'openclaw', status: 'thinking',
    team_id: 'team-alpha',
    // ...
  },
];

// WebSocket 이벤트 mock
export const mockEvents: UAEPEvent[] = [
  { ts: '2026-02-27T10:30:00Z', event_id: '1', source: 'claude_code',
    agent_id: 'cc-1', session_id: 's1', type: 'tool.start',
    data: { tool_name: 'Read', tool_category: 'file_read', summary: 'src/main.ts' } },
  // ...
];
```

### 11.3 개발 서버 Mock 모드

```
백엔드 없이 FE 독립 개발을 위한 Mock 서버:
  - Vite dev server + MSW(Mock Service Worker) 또는 자체 mock WebSocket
  - 3-5개의 가상 에이전트가 랜덤 상태 전환
  - 100ms~2초 간격으로 가상 이벤트 생성
  - 설정 파일로 시나리오 변경 (에이전트 수, 에러 빈도 등)

실행: pnpm --filter web dev:mock
```

---

## 12. 성능 고려사항

```
1. 에이전트 카드 리렌더 최적화
   - React.memo로 AgentCard 감싸기
   - agentStore에서 개별 agent selector 사용
   - 1초에 여러 번 갱신 시 requestAnimationFrame으로 배치

2. Activity Feed 가상화
   - 200개 이상 이벤트 시 react-window 또는 가상 스크롤
   - DOM 노드 최소화

3. 차트 성능
   - Recharts animationDuration 짧게 (300ms)
   - 시계열 데이터 60포인트 고정 (증가하지 않음)
   - 뷰포트 밖 차트는 렌더링 스킵 (IntersectionObserver)

4. WebSocket 메시지 처리
   - 메시지 수신 → 즉시 스토어 반영 (동기)
   - 렌더링은 React 배치 업데이트로 자연스럽게 병합
   - metrics:snapshot (1초 간격)은 가벼운 업데이트
```

---

## 13. 향후 확장 (Phase 2+에서 FE 팀 추가 작업)

```
Phase 2:
  □ 에이전트 카드 → 픽셀 뷰 전환 애니메이션
  □ 에이전트 상세 패널 내 미니 타임라인
  □ 비용 알림 임계치 설정 UI

Phase 3 (백엔드 API 완성됨 — v4):
  □ 세션 히스토리 목록 뷰 (GET /api/v1/sessions)
  □ 세션 재생(Playback) 컨트롤 (GET /api/v1/sessions/:id/replay)
    - gap_ms 활용 실시간 타이밍 재현
    - offset_ms 활용 시크바/타임라인
    - types 필터로 특정 이벤트만 재생
  □ 비용 분석 대시보드 (GET /api/v1/analytics/cost/*)
    - 비용 시계열 라인차트 (cost_timeseries)
    - 에이전트별 비용 파이차트 (cost/by-agent)
    - 팀별 비용 바차트 (cost/by-team)
    - 도구별 추정 비용 (cost/by-tool)
  □ 토큰 사용량 분석 (GET /api/v1/analytics/tokens)
    - 토큰 시계열 + 에이전트별 분석
  □ API 탐색: GET /api-docs/ → Swagger UI 활용
  □ 에이전트 그룹/팀 관리 설정 UI
  □ 다크/라이트 모드 토글
```

---

## 부록: 유사 사례 UI 참고

대시보드 설계 시 참고할 수 있는 유사 서비스:

```
Langfuse (오픈소스 LLM observability):
  - Trace 목록 + 상세 뷰 패턴
  - 비용/토큰 집계 대시보드
  - 필터/검색 패턴

LangSmith (LangChain):
  - Trace 타임라인 + 스텝별 상세
  - Run 목록 카드 패턴

Grafana:
  - 실시간 시계열 차트 + 패널 레이아웃
  - 변수/필터 기반 대시보드

AutoGen Studio:
  - 멀티 에이전트 팀 구성 UI
  - 에이전트별 메시지 흐름 패널
```
