# SPEC-005: Agent Observatory Domain Redesign

- **Status**: APPROVED FOR EXECUTION
- **Date**: 2026-03-06
- **Supersedes**: 2026-02-27 문서 묶음의 제품/IA 설명, `docs/S-004-observatory-evolution.md`의 제품 서사
- **References**:
  - `agent-observatory/packages/web/src/App.tsx`
  - `agent-observatory/packages/web/src/views/Dashboard/StatusBar.tsx`
  - `agent-observatory/packages/web/src/views/MissionControl/MissionControlView.tsx`
  - `agent-observatory/packages/server/src/core/history-store.ts`
  - `agent-observatory/packages/server/src/delivery/api.ts`
  - `agent-observatory/packages/server/src/delivery/websocket.ts`
  - `agent-observatory/packages/web/src/stores/agentStore.ts`
  - `agent-observatory/packages/web/src/stores/metricsStore.ts`
  - `agent-observatory/packages/web/src/stores/missionControlStore.ts`
  - `agent-observatory/docs/PAPERCLIP-ANALYSIS.md`
  - `.omx/plans/2026-03-06-observatory-redesign-consensus-plan.md`

---

## 1. Product definition

Agent Observatory는 **collector/UAEP 기반 관찰 시스템을 뿌리로 유지**하면서, 그 위에 쌓인 workflow/governance 기능을 **질문 중심의 하나의 제품**으로 재정렬한 운영 콘솔이다.

이 제품은 아래 3개의 핵심 질문에 답해야 한다.

1. **Observe** — 지금 무엇이 일어나고 있는가?
2. **Work** — 지금 무엇을 해야 하는가?
3. **Control** — 무엇을 승인·통제·설정해야 하는가?

추가로 `Admin`은 운영/마이그레이션/디버그 성격의 보조 영역이며, `Overview`는 도메인이 아니라 **교차 도메인 요약 surface**다.

---

## 2. Non-goals

다음은 이번 재설계 범위에서 제외한다.

- auth / role / permission 설계
- multi-company 모델
- Board / CEO 같은 조직 메타모델
- full Paperclip clone
- 대규모 rewrite 전제

모든 viewer는 관리자 전제로 두며, 접근제어 설계는 제품 taxonomy를 다시 흐리게 만들 수 있으므로 의도적으로 제외한다.

---

## 3. Canonical taxonomy

### 3.1 Top-level entry

최상위 UI entry는 다음으로 고정한다.

- `Overview`
- `Observe`
- `Work`
- `Control`
- `Admin`

### 3.2 Domain definitions

| Entry | 역할 | 포함되는 것 | 포함되지 않는 것 |
|---|---|---|---|
| Overview | 교차 도메인 요약 surface | KPI, 위험 신호, 도메인별 링크, 최근 핵심 변화 | 세부 workflow, 세부 설정, raw feed |
| Observe | 사실 관찰 | live agents, raw event/timeline, sessions, replay, pixel, metrics, cost telemetry | task 조작, approvals, adapters 설정 |
| Work | 일의 구조화 | tasks, goals, dependencies, comments, checkout | raw observability feed, approvals, migration |
| Control | 정책/운영 통제 | approvals, budgets, adapters, audit log, notifications | raw session replay, task board, debug panels |
| Admin | 운영자 전용 보조 기능 | migration, shadow, debug/tooling, one-off diagnostics | 일상 운영 UX의 핵심 흐름 |

### 3.3 Naming rules

- `Overview`만 cross-domain 위젯을 허용한다.
- `Observe`에서는 raw event feed와 session replay를 중심으로 보여준다.
- `Work`에서는 Task/Goal 중심 vocabulary만 사용한다.
- `Control`에서는 `raw event feed`가 아니라 `audit log`라는 용어를 사용한다.
- `Mission Control`은 제품명/최상위 nav가 아니라, 필요하면 `Work` 하위 전환기 용어로만 남긴다.

---

## 4. Current-state evidence and required remap

현재 shell은 이미 서로 다른 도메인을 최상위에서 혼합하고 있다.

### 4.1 Evidence from current code

- `App.tsx` 최상위 view: `dashboard`, `pixel`, `sessions`, `mission-control`, `approvals`, `activity-log`, `adapters`
- `StatusBar.tsx` nav: `Dashboard / Pixel / Sessions / Mission Control / Approvals / Activity / Adapters`
- `MissionControlView.tsx` subtab: `tasks / approvals / adapters / migration / activity / notifications`
- `agentStore.ts`의 `activeView`가 Observe/Work/Control/Admin이 아니라 feature 이름에 묶여 있음
- `missionControlStore.ts`가 Work + Control + Admin 상태를 한 store에 섞고 있음

### 4.2 Mapping table

| Current surface / feature | Current location | Target domain | Action |
|---|---|---|---|
| Dashboard summary | `DashboardView` | Overview | KPI 중심 요약으로 축소 |
| Live agent cards | Dashboard | Observe | 유지 |
| Dashboard activity feed (raw events) | Dashboard | Observe | raw event feed로 명시 |
| Sessions / replay | `SessionsView` | Observe | 유지 |
| Pixel | `PixelCanvasView` | Observe | live specialization으로 재배치 |
| Cost / metrics cards | Dashboard | Observe | 유지, work-context drilldown 추가 |
| Mission Control tasks | `MissionControlView > tasks` | Work | 최상위 `Work`로 승격 |
| Goals / comments / relations / checkout | API/store/task detail | Work | 유지 |
| Approvals | top-level + Mission Control subtab | Control | Work에서 제거 |
| Activity timeline (audit) | top-level + Mission Control subtab | Control | raw activity와 분리 |
| Adapters | top-level + Mission Control subtab | Control | 유지 |
| Notifications | Mission Control subtab | Control | 유지 |
| Migration panel | Mission Control subtab | Admin | 분리 |
| Shadow / debug / diagnostics | server admin endpoints | Admin | 제품 핵심 흐름에서 분리 |

---

## 5. Raw event feed vs audit log

현재 `Activity`라는 이름이 서로 다른 두 질문을 동시에 가리킨다.

### Observe: raw event feed

- 출처: UAEP event stream (`tool.start`, `llm.end`, `metrics.usage`, `session.*` 등)
- 질문: **지금 에이전트 런타임에서 무슨 일이 일어나고 있는가?**
- 주요 surface: dashboard live feed, sessions, replay, timeline

### Control: audit log

- 출처: mutating action log (`task updated`, `approval approved`, `checkout released`, `notification created` 등)
- 질문: **누가 무엇을 바꾸었는가?**
- 주요 surface: activity timeline, approvals history, notification history

이 둘은 모두 time-based stream이지만 목적이 다르므로 같은 탭/용어 아래 두지 않는다.

---

## 6. Domain contracts by code ownership

### 6.1 Frontend shell

| File / module | Current role | Target ownership |
|---|---|---|
| `packages/web/src/App.tsx` | feature별 뷰 스위칭 | shared shell; top-level domain entry 전환기 |
| `packages/web/src/views/Dashboard/StatusBar.tsx` | feature nav + global KPIs | shared shell + Overview summary nav |
| `packages/web/src/stores/agentStore.ts` | live agents + global activeView | shell + Observe state |
| `packages/web/src/stores/metricsStore.ts` | metrics snapshot | Observe |
| `packages/web/src/stores/missionControlStore.ts` | tasks/approvals/adapters/migration/activity/notifications 혼합 | Work + Control + Admin으로 분리 필요 |

### 6.2 Backend API

| API group | Current endpoints | Target domain |
|---|---|---|
| Observe API | `/api/v1/agents*`, `/api/v1/sessions*`, `/api/v1/metrics*`, `/api/v1/events/search` | Observe |
| Overview summary API | `/api/v1/dashboard/summary` | Overview-only summary surface |
| Work API | `/api/v2/tasks*`, `/api/v2/goals`, task comments, checkout | Work |
| Control API | `/api/v2/approvals*`, `/api/v2/activities`, `/api/v2/adapters*`, `/api/v2/notifications` | Control |
| Admin API | `/api/v1/migration/shadow-report`, diagnostic/test endpoints | Admin |
| Out of scope for redesign | `/api/v2/auth/status` | 유지하되 taxonomy driving feature로 보지 않음 |

### 6.3 WebSocket invalidation rules

`websocket.ts`는 현재 dashboard batch와 domain event를 일부 혼합한다. 앞으로는 아래 규칙으로 정렬한다.

| Event | Domain | Rule |
|---|---|---|
| `agent:state`, raw `event`, metrics snapshot | Observe | Observe 화면 실시간 갱신 |
| `task.updated`, `task.checkout` | Work | Work query/store invalidate |
| `approval.created`, `approval.updated`, `activity.logged`, `cost.alert`, notifications | Control | Control query/store invalidate |
| migration/debug 이벤트 | Admin | Admin 전용 |

---

## 7. Canonical work-context model

### 7.1 Current state

현재 코드 기준 사실은 다음과 같다.

- `UAEPEvent` top-level에는 `project_id`만 있고 `task_id`, `goal_id`는 없다.
- `HistoryStore.sessions`는 `project_id`, `model_id`만 저장한다.
- `HistoryStore.events`는 work-context 컬럼이 없고 JSON payload에 일부 문맥이 섞일 수 있다.
- `tasks`는 `goal_id`, `project`, `checkout_agent_id`를 가진다.
- `metrics.usage` 처리 시 세션 집계는 `project_id`를 event top-level 또는 payload에서 부분적으로만 상속한다.

즉, **Observe와 Work를 이어주는 연결축은 project 수준에서만 부분적으로 존재**하고, `task / goal / cost / session` 사이의 canonical linkage는 아직 없다.

### 7.2 Decision

`UAEPEvent` envelope에 아래 optional top-level field를 추가한다.

- `task_id?: string`
- `project_id?: string`
- `goal_id?: string`

그리고 아래 저장 규칙을 채택한다.

#### Events table

`events`에 nullable 컬럼 추가:

- `task_id TEXT NULL`
- `project_id TEXT NULL`
- `goal_id TEXT NULL`

#### Sessions table

`sessions`에 nullable 컬럼 추가:

- `task_id TEXT NULL`
- `project_id TEXT NULL`
- `goal_id TEXT NULL`

### 7.3 Inheritance rules

1. `session.start`에 work-context가 있으면 session canonical context로 설정한다.
2. `session.start`가 비어 있고 이후 event에서 첫 non-null context가 오면 session이 그것을 상속한다.
3. 같은 session에서 충돌하는 다른 non-null context가 오면 조용히 덮어쓰지 않는다.
   - 우선 event-level context만 기록하고
   - session-level context는 최초 canonical 값을 유지하거나
   - 이후 별도 lineage event/diagnostic로 다룬다.
4. pure observability session은 null context를 허용한다.

### 7.4 Cost attribution rules

- cost rollup의 최소 귀속 단위는 `(session_id, task_id, project_id, goal_id, agent_id, model_id)`다.
- `metrics.usage`는 event-level work-context를 우선 사용한다.
- event-level context가 없으면 session canonical context를 사용한다.
- Overview는 합계만 보여주고,
- Observe는 telemetry 사실을 보여주며,
- Work는 task/goal/project 관점의 linked session/cost를 drilldown으로 보여준다.

이 규칙으로 session / event / cost와 task / project / goal 사이 연결이 일관된다.

---

## 8. P0 / P1 / P2 backlog

### P0 — taxonomy and shell reset

1. 최상위 entry를 `Overview / Observe / Work / Control / Admin`으로 고정
2. `Overview`를 summary-only surface로 정의
3. `Mission Control`에서 `approvals / adapters / migration / activity / notifications`를 분리할 재배치 표 작성
4. raw event feed vs audit log 용어 분리
5. auth / role / permission을 현재 계획 범위에서 제외 명시

### P1 — work-context and domain boundaries

1. `UAEPEvent`, `history-store`, session schema에 `task_id/project_id/goal_id` 설계 반영
2. `api.ts` route 분류를 Observe / Work / Control / Admin 기준으로 재문서화
3. `websocket.ts` invalidation 규칙을 domain-aware하게 문서화
4. FE store를 `agent/metrics`(Observe)와 `work/control/admin`으로 분리하는 migration plan 작성
5. cost telemetry를 task/project/goal drilldown과 연결하는 read model 계획 수립

### P2 — UX migration

1. Dashboard를 `Overview`로 축소
2. Sessions / Replay / Pixel / raw timeline을 `Observe` 하위로 재배치
3. Task board / goal progress / comments / dependencies를 `Work` 하위로 정리
4. Approvals / adapters / notifications / audit log를 `Control` 하위로 정리
5. Migration / shadow / debug panels를 `Admin`으로 격리

---

## 9. Paperclip adoption policy

### Adopt

- task comments as the communication channel
- goal traceability
- atomic checkout discipline
- adapter capability contracts
- approvals / audit log as explicit control-plane concerns

### Defer

- task-scoped session resume
- richer wakeup coordinator orchestration
- keyboard-first dense shell refinements
- deeper organizational planning abstractions beyond goal/project/task

### Reject

- Board / CEO organization model
- multi-company tenancy as a near-term requirement
- auth / role / permission expansion in this redesign
- PostgreSQL rewrite as a prerequisite
- full Paperclip product cloning

---

## 10. Acceptance checklist

이 문서가 구현팀의 기준이 되려면 아래가 모두 가능해야 한다.

1. 현재 상위 화면/기능이 `Overview / Observe / Work / Control / Admin` 중 하나로 100% 매핑된다.
2. `Overview` 외 화면이 교차 도메인 위젯을 직접 포함하지 않는다.
3. `Observe`와 `Control`의 스트림이 raw event feed vs audit log로 분리 설명된다.
4. work-context 모델이 `task_id / project_id / goal_id` 기준으로 설명된다.
5. auth / role / permission이 redesign 범위 밖으로 명시된다.
6. 새 문서만 읽어도 제품 목적, 경계, backlog, Paperclip 차용 범위를 이해할 수 있다.
