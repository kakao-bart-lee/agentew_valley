# FE 에이전트 팀 핸드오프 — 2026-02-27

> 백엔드 팀(본체)에서 FE 에이전트 팀에 전달하는 작업 현황 및 다음 단계 가이드.

---

## 1. 방금 완료된 작업: 구조 정합성 수정

백엔드 팀이 `feat/dashboard` 브랜치를 main에 병합한 뒤, 코드 리뷰를 통해 아래 구조적 문제를 발견하고 수정했습니다.

### 수정 완료 항목

| 우선순위 | 문제 | 수정 내용 |
|---------|------|----------|
| **P0** | 패키지명이 `"web"`으로 설정됨 | `"@agent-observatory/web"` + version `"0.1.0"` 으로 변경 |
| **P0** | `types/agent.ts` 등에서 타입을 직접 재정의 (51줄+) | `@agent-observatory/shared`로부터 re-export 방식으로 전환 |
| **P0** | `package.json`에 shared 의존성 미선언 | `"@agent-observatory/shared": "workspace:*"` 추가 |
| **P1** | `package-lock.json` (npm) 존재 | 삭제. 프로젝트는 pnpm workspace 사용 |
| **P1** | `useSocket` 훅이 호출마다 새 Socket.IO 인스턴스 생성 | 모듈 레벨 싱글턴 + refCount 패턴으로 재작성 |
| **P2** | Mock 데이터가 무조건 로드됨 | `VITE_MOCK=true` 환경변수 조건부 동적 import로 변경 |

### 타입 re-export 구조 (변경 후)

```
packages/web/src/types/
├── agent.ts    → export type { AgentStatus, ToolCategory, AgentSourceType, AgentLiveState } from '@agent-observatory/shared'
├── metrics.ts  → export type { MetricsSnapshot, MetricsTimeseries } from '@agent-observatory/shared'
└── uaep.ts     → export type { UAEPEventType, UAEPEvent } from '@agent-observatory/shared'
```

> **규칙**: web 패키지에서 타입을 직접 정의하지 마세요. 모든 도메인 타입은 `@agent-observatory/shared`에서 가져옵니다. 만약 FE 전용 UI 타입이 필요하면 `types/ui.ts` 같은 별도 파일에 작성하되, UAEP/Agent/Metrics 타입은 반드시 shared에서 가져와야 합니다.

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

#### 3-1. Activity Feed — 전체 이벤트 스트림 미수신

**문제**: `useActivityFeed`는 `socket.on('event')` 를 수신하지만, 서버의 WebSocket은 `event`를 **subscribe된 에이전트에게만** 전달합니다.

```typescript
// server/websocket.ts (line 98-107)
eventBus.subscribe((event: UAEPEvent) => {
    for (const [socketId, state] of clients) {
        if (state.subscribedAgents.has(event.agent_id)) {  // ← 구독된 에이전트만!
            socket.emit('event', event);
        }
    }
});
```

즉, 현재 FE는 `subscribe`를 명시적으로 호출하지 않으므로 **Activity Feed에 아무 이벤트도 표시되지 않습니다.**

**해결 방안 (선택)**:
- **(A)** FE에서 연결 시 모든 에이전트를 subscribe (간단하지만 대량 이벤트)
- **(B)** 서버에 `subscribe_all` 또는 dashboard 뷰에서는 전체 이벤트를 broadcast하는 모드 추가
- **(C)** 서버의 `set_view('dashboard')` 처리 시, dashboard 뷰 클라이언트에게는 모든 이벤트를 전송하도록 변경 — **권장**

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
pnpm --filter @agent-observatory/server start

# 환경변수:
#   PORT=3000 (기본)
#   CLAUDE_CODE_WATCH_PATHS=~/.claude/projects (기본)
#   OPENCLAW_WATCH_PATHS=~/.openclaw/agents (기본)
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
  → HistoryStore.append()
  → REST API에서 히스토리 조회 가능
```

### 4-3. WebSocket 이벤트 정리 (서버가 실제로 emit하는 것)

| 이벤트 | 빈도 | 데이터 | 수신 조건 |
|--------|------|--------|----------|
| `init` | 연결 시 1회 | `{ agents: AgentLiveState[], metrics: MetricsSnapshot }` | 무조건 |
| `agent:state` | 상태 변경 시 | `AgentLiveState` | dashboard 뷰: 1초 배치 |
| `agent:remove` | 세션 종료 시 | `{ agent_id: string }` | 무조건 (io.emit) |
| `metrics:snapshot` | 5초 간격 | `MetricsSnapshot` | 무조건 (io.emit) |
| `event` | 이벤트 발생 시 | `UAEPEvent` | **subscribe한 에이전트만!** |

> **주의**: `event` 스트림은 현재 subscribe 기반입니다. Activity Feed가 전체 이벤트를 받으려면 서버 수정이 필요합니다 (§3-1 참조). 백엔드 팀에 요청해주세요.

### 4-4. REST API (구현 완료)

```
GET  /api/v1/agents              → { agents: AgentLiveState[], total: number }
GET  /api/v1/agents/:id          → { agent: AgentLiveState }
GET  /api/v1/agents/:id/events   → { events: UAEPEvent[], total, offset, limit }
                                    ?limit=50&offset=0&type=tool.start
GET  /api/v1/sessions            → { sessions: [...], total }
GET  /api/v1/sessions/:id        → { session_id, events, total }
GET  /api/v1/metrics/summary     → { metrics: MetricsSnapshot }
GET  /api/v1/metrics/timeseries  → { metric, from, data: [{ts,value},...] }
                                    ?metric=tokens_per_minute&from=30
GET  /api/v1/config              → { config: { watch_paths, ... } }
POST /api/v1/events              → 외부 이벤트 수신 (HTTP Collector)
POST /api/v1/events/batch        → 배치 수신
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

1. **Activity Feed 이벤트 수신 문제 해결** — 서버 팀에 `set_view('dashboard')` 시 전체 이벤트 전송 요청, 또는 FE에서 전체 subscribe
2. **subscribe/unsubscribe 구현** — 카드 클릭 시 `socket.emit('subscribe', agentId)`, 패널 닫힘 시 `unsubscribe`
3. **set_view 뷰 전환 연동** — 현재 connect 시 1회만 emit. 뷰 전환 탭 구현 시 재전송 필요
4. **에러 상태/재연결 UI** — 연결 끊김 시 반투명 오버레이, 자동 재연결 표시

### Phase B: 멀티 에이전트/팀 UX

5. **팀 필터 UI** — `AgentCardFilters`에 team_id 기반 필터 버튼 추가
6. **카드 그룹바이 팀** — `AgentCardGrid`에 team_id별 섹션 분리 토글
7. **카드에 팀/서브에이전트 표시** — team_id 뱃지, 자식 에이전트 칩
8. **RelationshipGraph 팀 그룹핑** — team_id별 점선 박스 경계

### Phase C: 차트 분리 + 추가

9. MetricsPanel 내 차트를 `charts/` 서브디렉토리로 분리
10. **CostChart** 추가 (Cost/hr 라인차트)
11. **ActiveAgentsChart** 추가 (활성 에이전트 에어리어 차트)
12. **ActivityFeedFilters** 추가 (에이전트별/타입별 필터 UI)

### Phase D: 상세 패널 + 인터랙션

13. **AgentDetailPanel** 사이드패널 구현 (에이전트 상세 + 이벤트 히스토리)
14. REST API 연동: `GET /api/v1/agents/:id/events` 호출
15. 카드 클릭 → 패널 열기/닫기 인터랙션
16. 관계 그래프 노드 클릭 → 카드 하이라이트 연동

### Phase E: 마무리

17. 카드/피드 등장/소멸 애니메이션
18. 스켈레톤 로더
19. 카드 정렬 모드 UI
20. Vitest + RTL 단위 테스트 작성

---

## 6. 참고: 수정된 파일 목록

이번 정합성 수정에서 변경된 파일입니다. FE 팀이 pull 후 확인해야 할 파일:

```
# 구조 변경
packages/web/package.json                     — 패키지명, 버전, shared 의존성
packages/web/src/types/agent.ts               — re-export로 전환 (5줄)
packages/web/src/types/metrics.ts             — re-export로 전환 (4줄)
packages/web/src/types/uaep.ts                — re-export로 전환 (4줄)
packages/web/src/hooks/useSocket.ts           — 싱글턴 재작성 (79줄)

# 빌드 오류 수정
packages/web/src/mock.ts                      — UAEPEvent import 제거
packages/web/src/dev-mock.ts                  — 정리
packages/web/src/views/Dashboard/DashboardView.tsx    — mock 환경분리
packages/web/src/views/Dashboard/ActivityFeed.tsx     — unused React 제거
packages/web/src/views/Dashboard/ActivityFeedItem.tsx — unknown→Boolean() 캐스트
packages/web/src/views/Dashboard/AgentCard.tsx        — unused React 제거
packages/web/src/views/Dashboard/AgentCardFilters.tsx — import 수정
packages/web/src/views/Dashboard/AgentCardGrid.tsx    — unused import 제거
packages/web/src/views/Dashboard/MetricsPanel.tsx     — unused React 제거
packages/web/src/views/Dashboard/RelationshipGraph.tsx — unused React 제거

# 삭제
packages/web/package-lock.json               — npm lock 제거 (pnpm 사용)
```

---

## 7. 커밋 히스토리 참조

```
558b4f2 web: align package structure with monorepo conventions  ← 정합성 수정
b24a624 Merge branch 'feat/dashboard'                          ← FE 병합
e873858 feat(dashboard): initialize React/Vite web application ← FE 초기 구현
85611bf feat: implement Phase 1 backend (shared, collectors, server)
6ad8960 chore: initial commit
```
