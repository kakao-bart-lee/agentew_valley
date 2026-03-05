# Paperclip 심층 분석 및 Agent Observatory 적용 방안

> 분석일: 2026-03-06 (v2 — 코드베이스 + 설계 문서 전수 분석)
> 대상: https://github.com/paperclipai/paperclip
> 소스: 로컬 클론 `/Users/bclaw/workspace/agentic/paperclip` + DeepWiki MCP
> 목적: Agent Observatory에 도입할 수 있는 아키텍처 및 기능 벤치마킹

---

## 1. Paperclip 프로젝트 개요

### 1.1 비전
> "Paperclip is the backbone of the autonomous economy."

Paperclip은 **"자율 AI 회사(Autonomous AI Company)"의 운영 체제**를 지향한다.
단순한 태스크 보드가 아니라, AI 에이전트들을 '직원'으로 고용하고, 조직도를 구성하고, 예산을 배정하고, 거버넌스를 적용하는 **회사 단위 컨트롤 플레인**이다.

### 1.2 기술 스택
| 계층 | 기술 |
|------|------|
| Frontend | React 19 + Vite + TanStack Router + React Query |
| Backend | TypeScript + Hono (REST API) |
| Database | PostgreSQL (Drizzle ORM), 로컬: 내장 PGlite |
| Auth | BetterAuth (세션 기반) + Agent API Key (Bearer) |
| 실시간 | WebSocket (회사 단위 채널) |

### 1.3 코드베이스 규모
- **Server**: ~19,600 LOC (TypeScript)
- **UI**: ~27,300 LOC (React TSX)
- **DB Schema**: 20+ 테이블 (Drizzle ORM)
- **Adapters**: claude_local, codex_local, opencode_local, cursor, openclaw, process, http

---

## 2. 핵심 설계 철학 (Design Principles)

Paperclip의 설계 문서(`SPEC.md`, `SPEC-implementation.md`, `GOAL.md`)에서 도출한 핵심 원칙:

### 2.1 "Surface problems, don't hide them"
- 자동 복구(auto-reassign)를 **의도적으로 하지 않음**. Stale 태스크를 대시보드에 노출하여 인간 또는 관리자 에이전트가 판단하도록 함.
- **우리에게 주는 교훈**: Observatory도 "문제를 보여주는 것"에 집중해야 함. 자동 수정보다 가시성이 우선.

### 2.2 "Tasks are the communication channel"
- 별도의 메시징/채팅 시스템 없음. 모든 에이전트 간 소통은 **태스크 + 코멘트**를 통해 이루어짐.
- **우리에게 주는 교훈**: 현재 우리는 텔레그램 그룹으로 소통하는데, 태스크 코멘트 시스템을 도입하면 컨텍스트가 작업에 직접 붙어 추적성이 비약적으로 향상됨.

### 2.3 "All work traces to the goal"
- **Initiative → Project → Milestone → Issue → Sub-issue** 계층. 모든 태스크는 반드시 상위 목표로 연결.
- 에이전트가 "왜 이 일을 하는가?"를 항상 알 수 있어야 함.

### 2.4 "Unopinionated about agent runtime"
- 어댑터 패턴으로 어떤 에이전트든 연결 가능. 최소 계약: "호출 가능할 것(be callable)".
- 3단계 통합 레벨: ① Callable → ② Status Reporting → ③ Fully Instrumented.

### 2.5 "Company is the unit of organization"
- 모든 것이 Company 아래에 스코핑됨. 에이전트, 태스크, 비용, 목표 모두 company_id FK.

---

## 3. 데이터 모델 심층 분석

### 3.1 핵심 테이블 관계도

```
companies ─┬─ agents (조직도, reports_to 자기참조)
           ├─ goals (목표 계층, parent_id 자기참조)
           ├─ projects (goal_id FK)
           ├─ issues (project_id, goal_id, parent_id, assignee_agent_id)
           ├─ cost_events (agent_id, issue_id, project_id, goal_id)
           ├─ heartbeat_runs (agent_id, wakeup_request_id)
           ├─ approvals (requested_by_agent_id, decided_by_user_id)
           └─ activity_log (actor_type, actor_id, entity_type, entity_id)
```

### 3.2 Issues 테이블 (핵심)
Paperclip의 Issue는 Linear의 영향을 강하게 받았음:
- **Human-readable ID**: `ENG-123` 형식 (team key + auto-increment)
- **Workflow States**: 팀별 커스텀 상태 + 6개 고정 카테고리 (Triage/Backlog/Unstarted/Started/Completed/Cancelled)
- **Priority**: 5단계 고정 (None/Urgent/High/Medium/Low)
- **Relations**: blocks/blocked_by/related/duplicate (에이전트 간 의존성 관리)
- **Billing Code**: 크로스팀 작업 시 비용 귀속 추적
- **Request Depth**: 원래 요청자로부터 몇 단계 위임되었는지 추적

### 3.3 에이전트 런타임 상태 관리
Paperclip은 에이전트 상태를 **3개 테이블**로 분리 관리:
1. `agent_runtime_state`: 에이전트별 누적 토큰/비용, 마지막 세션 ID
2. `agent_task_sessions`: **(agent_id, task_key)** 조합별 세션 파라미터 — 같은 에이전트가 다른 태스크를 작업할 때 각각 독립적인 세션 유지
3. `agent_wakeup_requests`: 깨우기 요청 큐 (timer/assignment/on_demand/automation)

### 3.4 비용 이벤트 (`cost_events`)
```sql
cost_events:
  agent_id      -- 누가
  issue_id      -- 무슨 일을 하며
  project_id    -- 어느 프로젝트에서
  goal_id       -- 어떤 목표를 위해
  billing_code  -- 비용은 누구에게 귀속
  provider      -- 어떤 모델 프로바이더
  model         -- 어떤 모델
  input_tokens  -- 입력 토큰
  output_tokens -- 출력 토큰
  cost_cents    -- 비용 (센트)
```
이 구조로 **에이전트별, 태스크별, 프로젝트별, 목표별, 모델별** 비용을 다차원으로 분석 가능.

---

## 4. Heartbeat & Wakeup 시스템 (에이전트 실행 엔진)

### 4.1 하트비트 프로시저 (9단계)
에이전트가 깨어날 때마다 반드시 따르는 프로토콜:

1. **Identity** — `GET /agents/me`로 자기 정보 확인
2. **Approval follow-up** — 승인 관련 트리거인지 확인
3. **Get assignments** — 할당된 이슈 목록 조회 (inbox)
4. **Pick work** — in_progress → todo → blocked 순으로 우선순위
5. **Checkout** — **Atomic Checkout** (409 시 다른 태스크 선택)
6. **Understand context** — 이슈 상세 + 부모 체인(ancestors) + 코멘트 읽기
7. **Do the work** — 실제 작업 수행
8. **Update status** — 상태 업데이트 + 코멘트
9. **Delegate** — 필요 시 하위 태스크 생성

### 4.2 Wakeup Coordinator (중앙 집중 깨우기)
모든 깨우기 요청이 하나의 서비스로 통합:
- **Timer**: 주기적 스케줄 (intervalSec)
- **Assignment**: 태스크 할당 시 자동 깨우기
- **On-demand**: 수동 ping
- **Automation**: 콜백/시스템 자동화

중복 방지: 이미 실행 중이면 coalesce (병합).

### 4.3 Task-scoped Session Resume
Paperclip의 가장 정교한 기능 중 하나:
- 같은 에이전트가 태스크 A를 작업하다 중단 → 다음 하트비트에서 태스크 A의 **이전 세션을 자동 복구**
- 태스크 B로 전환하면 별도의 세션으로 시작
- `(agent_id, adapter_type, task_key)` 조합으로 세션을 구분

---

## 5. 어댑터 아키텍처

### 5.1 어댑터 인터페이스
```typescript
interface AgentRunAdapter {
  type: string;
  capabilities: {
    resumableSession: boolean;  // 세션 복구 가능 여부
    statusUpdates: boolean;     // 실시간 상태 보고
    logStreaming: boolean;      // 로그 스트리밍
    tokenUsage: boolean;        // 토큰 사용량 보고
  };
  invoke(input, hooks, signal): Promise<AdapterInvokeResult>;
}
```

### 5.2 내장 어댑터 목록
| 어댑터 | 실행 방식 | 세션 복구 | 비용 추적 |
|--------|-----------|-----------|-----------|
| claude_local | `claude --print` CLI | ✅ (session_id) | ✅ (total_cost_usd) |
| codex_local | `codex exec --json` | ✅ (thread_id) | △ (토큰만) |
| opencode_local | opencode CLI | ✅ | ✅ |
| cursor | cursor CLI | ✅ | ✅ |
| openclaw | OpenClaw webhook | ❌ | ✅ |
| process | 일반 쉘 커맨드 | ❌ | ❌ |
| http | HTTP webhook | ❌ | ❌ |

### 5.3 로그 저장소 분리 (RunLogStore)
풀 로그는 PostgreSQL이 아닌 별도 저장소에 보관:
- `local_file`: 로컬 디스크 (개발용)
- `object_store`: S3/R2/GCS (프로덕션)
- `postgres`: DB 직접 저장 (소규모)
DB에는 `stdout_excerpt`/`stderr_excerpt`만 저장하여 진단 가능성은 유지하면서 DB 비대화 방지.

---

## 6. 거버넌스 시스템

### 6.1 Board (인간 감독자)
- 모든 회사에 1명의 Board 운영자 (V1)
- **무제한 권한**: 에이전트 일시정지/해고, 태스크 재배정, 예산 변경, 승인/거부
- 에이전트가 생성한 태스크도 Board가 언제든 개입 가능

### 6.2 Approval Gate
두 가지 유형:
1. `hire_agent`: 새 에이전트 채용 요청 → Board 승인 필요
2. `approve_ceo_strategy`: CEO의 전략 제안 → Board 승인 후 실행

### 6.3 Budget Enforcement (3단계)
1. **Visibility**: 대시보드에서 실시간 비용 확인
2. **Soft Alert**: 80% 도달 시 경고
3. **Hard Ceiling**: 100% 도달 시 자동 일시정지 + Board 알림

---

## 7. UI 설계 분석

### 7.1 설계 철학
> "Dense but scannable. Keyboard-first. Dark theme default."

Linear에서 영감을 받은 프로페셔널 UI:
- 3-zone 레이아웃 (Sidebar 240px + Main Content + Properties Panel 320px)
- Cmd+K 글로벌 검색
- 인라인 편집 우선 (모달 최소화)

### 7.2 핵심 페이지 (27개 TSX 파일)
- **Dashboard**: MetricCard 4개 + RunActivityChart + PriorityChart + IssueStatusChart + SuccessRateChart + ActiveAgentsPanel
- **OrgChart**: 에이전트 보고 체계 트리 시각화 (432 LOC)
- **Issues/MyIssues**: 칸반 + 리스트 뷰, 프로젝트/에이전트/상태 필터
- **Costs**: 에이전트/프로젝트/모델별 비용 차트
- **Approvals**: 승인 대기/이력 관리
- **Activity**: 감사 로그 스트림

### 7.3 실시간 업데이트 아키텍처
```
Server (EventEmitter) → WebSocket(/api/companies/:id/events/ws) → UI
  ├─ LiveUpdatesProvider (글로벌 — React Query 캐시 무효화)
  ├─ LiveRunWidget (이슈 상세 — 개별 run 로그 구독)
  └─ ActiveAgentsPanel (대시보드 — 전체 에이전트 모니터링)
```
- 6개 이벤트 타입: `heartbeat.run.queued/status/event/log`, `agent.status`, `activity.logged`
- React Query 캐시 무효화로 상태 일관성 유지
- 연결 끊김 시 자동 재연결 + short polling 폴백

---

## 8. Agent Observatory에 도입할 기능 (개정판)

### 🔴 P0 — 즉시 도입 (높은 ROI, 낮은 난이도)

#### 8-1. Atomic Task Checkout
- **Paperclip 구현**: 단일 SQL `UPDATE ... WHERE status IN (?) AND (assignee IS NULL OR assignee = ?)`. 0 rows updated → 409.
- **우리 적용**: SQLite `tasks`에 `checkout_agent_id`, `checkout_run_id`, `checkout_at` 추가.

#### 8-2. 다차원 비용 추적 (Cost Events)
- **Paperclip 구현**: `cost_events` 테이블에 agent/issue/project/goal/billing_code 모두 기록.
- **우리 적용**: HistoryStore에 `project_id` 컬럼 추가. `getCostByProject()`, `getCostByAgent()` 메서드 구현.

#### 8-3. 월간 예산 + 자동 일시정지 알림
- **Paperclip 구현**: `budgetMonthlyCents` vs `spentMonthlyCents`. 80% soft alert, 100% hard stop.
- **우리 적용**: 에이전트별 월간 한도 설정 → 초과 시 텔레그램 알림 + 대시보드 경고 배지.

#### 8-4. Stale Task Detection
- **Paperclip 구현**: `in_progress` 상태인데 `started_at`이 1시간 이상 지난 태스크를 대시보드에 자동 표시.
- **우리 적용**: 동일 로직으로 "방치된 태스크" 경고 위젯 추가.

### 🟠 P1 — 단기 도입 (구조적 개선)

#### 8-5. Goal Hierarchy (목표 계층)
- **Paperclip 구현**: `goals` 테이블 (company/team/agent/task 레벨) + parentId 트리.
- **우리 적용**: `goals` 테이블 신설. `GOALS.md` 파일 파서로 Source of Truth 유지. UI에서 Goal → Project → Task 드릴다운.

#### 8-6. Task Comments (태스크 코멘트)
- **Paperclip 구현**: `issue_comments` 테이블. 에이전트가 작업 중 컨텍스트를 코멘트로 남김.
- **우리 적용**: 현재 에이전트 간 소통이 텔레그램에 흩어져 있음. 태스크에 직접 코멘트를 달면 작업 맥락이 보존됨.

#### 8-7. Issue Relations & Dependencies
- **Paperclip 구현**: `blocks/blocked_by/related/duplicate` 4가지 관계. 블로킹 이슈 해결 시 자동 플래그 변경.
- **우리 적용**: S-004/F-002에서 이미 계획한 의존성 시각화의 데이터 모델로 활용.

#### 8-8. Approval Gate (승인 게이트)
- **Paperclip 구현**: `approvals` 테이블 + payload JSONB + 결정자 기록.
- **우리 적용**: S-004/F-004 구현 시 이 스키마를 그대로 차용.

#### 8-9. React Query 캐시 무효화 패턴
- **Paperclip 구현**: WebSocket 이벤트 수신 시 `invalidateQueries()`로 관련 캐시만 선택적 무효화.
- **우리 적용**: 현재 폴링 기반인 데이터 갱신을 이벤트 기반으로 전환.

### 🟡 P2 — 중기 도입 (전략적 확장)

#### 8-10. Adapter Registry (플러거블 어댑터)
- **Paperclip 구현**: `ServerAdapterModule` 인터페이스. type/execute/testEnvironment/sessionCodec/models 표준화.
- **우리 적용**: Collector 패턴을 Adapter 인터페이스로 리팩토링. capabilities 메타데이터 추가.

#### 8-11. Task-scoped Session Resume
- **Paperclip 구현**: `agent_task_sessions` 테이블로 (agent, task) 쌍마다 독립 세션 유지.
- **우리 적용**: 에이전트가 태스크 전환 시 컨텍스트를 잃지 않도록 세션 상태 관리 도입.

#### 8-12. Run Log Store 분리
- **Paperclip 구현**: 풀 로그는 local_file/S3에 보관, DB에는 excerpt만 저장.
- **우리 적용**: SQLite 비대화 방지. 현재 Observatory의 로그가 커지면 동일 패턴 필요.

#### 8-13. Company Portability Package
- **Paperclip 구현**: 에이전트 구성 전체를 `paperclip.manifest.json` + markdown으로 export/import.
- **우리 적용**: 에이전트 팀 구성을 패키지로 내보내어 다른 환경에서 재현 가능하게 함.

---

## 9. 도입하지 않을 기능

| 기능 | 이유 |
|------|------|
| Multi-Company 격리 | 우리는 단일 조직. companyId 스코핑은 불필요한 복잡도. |
| PostgreSQL 전환 | SQLite가 현재 규모에 적합. |
| BetterAuth 인증 | OpenClaw의 인증 체계로 충분. |
| ClipMart/ClipHub | 에이전트 템플릿 마켓은 현재 불필요. |
| Human-readable Issue ID | 우리는 Linear 연동이 있어 별도 식별자 불필요. |
| Workflow State 커스터마이징 | 현재 규모에서 고정 상태로 충분. |

---

## 10. 구현 우선순위 (Phase Plan)

### Phase 1 — Foundation (1~2주)
| ID | 기능 | 난이도 | 효과 |
|----|------|--------|------|
| P0-1 | Atomic Task Checkout | ⬜ 낮음 | 에이전트 경합 방지 |
| P0-2 | Cost Events by Project | ⬜ 낮음 | 프로젝트 사후 분석 |
| P0-3 | Budget Alert | ⬜ 낮음 | 비용 폭주 방지 |
| P0-4 | Stale Task Detection | ⬜ 낮음 | 방치 태스크 가시화 |

### Phase 2 — Structure (2~3주)
| ID | 기능 | 난이도 | 효과 |
|----|------|--------|------|
| P1-1 | Goal Hierarchy | 🟨 중간 | 전략적 정렬 |
| P1-2 | Task Comments | 🟨 중간 | 컨텍스트 보존 |
| P1-3 | Issue Relations | 🟨 중간 | 의존성 관리 |
| P1-4 | Approval Gate | 🟨 중간 | 거버넌스 강화 |
| P1-5 | React Query 캐시 무효화 | ⬜ 낮음 | UI 반응성 |

### Phase 3 — Scale (4주+)
| ID | 기능 | 난이도 | 효과 |
|----|------|--------|------|
| P2-1 | Adapter Registry | 🟥 높음 | 에이전트 확장성 |
| P2-2 | Session Resume | 🟨 중간 | 작업 연속성 |
| P2-3 | Run Log Store | 🟨 중간 | DB 최적화 |
| P2-4 | Portability Package | 🟨 중간 | 환경 재현성 |

---

## 11. 핵심 인사이트 요약

1. **Paperclip의 가장 큰 강점은 "설계 문서의 품질"이다.** `SPEC.md`(260줄), `SPEC-implementation.md`(600줄), `agent-runs.md`(500줄)에 걸쳐 모든 설계 결정이 명문화되어 있어, 구현자가 모호함 없이 작업할 수 있다. 우리도 이 수준의 스펙 문서를 작성해야 한다.

2. **"Tasks are the communication channel"** 원칙은 우리에게 가장 큰 패러다임 전환을 요구한다. 현재 텔레그램에 흩어진 에이전트 커뮤니케이션을 태스크 코멘트로 통합하면 추적성이 비약적으로 향상될 것.

3. **Atomic Checkout + Budget Enforcement**는 즉시 도입 가능하고 ROI가 가장 높다. Paperclip의 SQL 패턴을 거의 그대로 SQLite에 적용할 수 있다.

4. **Task-scoped Session Resume**는 Paperclip만의 독창적 기능이다. 에이전트가 여러 태스크를 번갈아 작업할 때 각 태스크별 컨텍스트를 유지하는 이 패턴은, 우리의 멀티 프로젝트 환경에서 큰 가치를 발휘할 것이다.

5. **UI 설계에서 배울 점**: Dense-but-scannable, keyboard-first, 인라인 편집 우선. 특히 LiveUpdatesProvider의 React Query 캐시 무효화 패턴은 우리 대시보드의 실시간성을 크게 개선할 수 있다.
