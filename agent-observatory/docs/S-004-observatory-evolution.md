# SPEC-004: Agent Observatory Evolution — Unified Plan

- **Status**: APPROVED
- **Author**: Erika + Bart
- **Date**: 2026-03-06 (v2 — Paperclip 연구 통합)
- **Project**: agent-observatory
- **Reference**: `agent-observatory/docs/PAPERCLIP-ANALYSIS.md`

---

## 1. 목표 (Mission)

Agent Observatory를 **"에이전트 팀의 관제 대시보드"**에서 **"에이전트 거버넌스 & 생산성 플랫폼"**으로 진화시킨다.

### 1.1 핵심 질문 (이 플랫폼이 답해야 하는 것)

| 관점 | 질문 |
|------|------|
| **프로젝트 오너 (Bart)** | 이 프로젝트의 진척도가 몇 %인가? 총 비용은 얼마인가? 병목은 어디인가? |
| **코디네이터 (Erika)** | 어떤 에이전트가 멈춰 있는가? 비용이 폭주하고 있는가? 어디에 개입해야 하는가? |
| **에이전트 팀** | 내가 지금 해야 할 일은 무엇인가? 이 일은 왜 하는 것인가? 누가 블로킹하는가? |

### 1.2 설계 원칙 (Paperclip에서 차용)

1. **"Surface problems, don't hide them."** — 자동 복구보다 가시성이 우선. 문제를 숨기지 말고 보여준다.
2. **"All work traces to the goal."** — 모든 태스크는 상위 목표에 연결되어야 한다.
3. **Atomic Ownership** — 하나의 태스크에 하나의 담당자. 경합 방지.
4. **File = Source of Truth, DB = Read Model** — 기존 하이브리드 모델(ADR-001) 유지. Paperclip처럼 DB를 SoT로 전환하지 않음.

### 1.3 우리 아키텍처와의 차이점 (Paperclip 대비)

| Paperclip | 우리 (Observatory) | 결정 |
|-----------|---------------------|------|
| 영속 에이전트 + 멀티태스크 | 태스크별 인스턴스 스폰 (class/instance) | Task-scoped Session Resume 불필요 |
| PostgreSQL (Drizzle) | SQLite (하이브리드) | SQLite 유지, 필요시 전환 |
| Multi-Company 격리 | 단일 조직 | company_id 스코핑 불필요 |
| 자체 인증 (BetterAuth) | OpenClaw Bearer 토큰 | 기존 인증 유지 |
| 자체 하트비트 스케줄러 | OpenClaw Cron + 시스템 crontab | 기존 스케줄러 유지 |

---

## 2. 기능 정의 (Feature Catalog)

### Phase 1 — Foundation (기반) | 예상: 1~2주

#### F-001: Project-based View & Grouping
- **출처**: 기존 계획 + Paperclip `projects` 테이블 참고
- **목적**: 프로젝트 단위로 태스크, 비용, 진척도를 한눈에 파악.
- **구현**:
  - `TASK.md` 파서 업데이트: `(project-name)` 접두사 인식
  - SQLite `tasks` 테이블에 `project` 컬럼 추가
  - 칸반 보드 상단 "Group by: Agent | Project | Status" 토글
  - 프로젝트별 필터링 드롭다운

#### F-002: Multi-dimensional Cost Tracking
- **출처**: Paperclip `cost_events` 테이블 (`server/src/services/costs.ts`)
- **목적**: 에이전트별, 프로젝트별, 모델별 비용을 다차원으로 추적.
- **구현**:
  - HistoryStore의 `sessions` 테이블에 `project_id` 컬럼 추가
  - `getCostByProject()`, `getCostByAgent()`, `getCostByModel()` 메서드 추가
  - 프로젝트 종료 시 자동 집계 리포트 생성 (총 비용, 토큰량, 작업 시간)
  - 대시보드에 Cost Summary 카드 추가

#### F-003: Atomic Task Checkout
- **출처**: Paperclip `POST /issues/:issueId/checkout` 패턴
- **목적**: 두 에이전트가 동시에 같은 태스크를 작업하는 경합(race condition) 방지.
- **구현**:
  - SQLite `tasks` 테이블에 `checkout_agent_id`, `checkout_at` 컬럼 추가
  - MissionControlCollector가 태스크 할당 시 Atomic UPDATE 수행
  - 이미 체크아웃된 태스크에 접근 시 409 상태 반환
  - 체크아웃 상태를 칸반 보드에 시각적으로 표시 (🔒 아이콘)

#### F-004: Stale Task & Budget Alert
- **출처**: Paperclip `dashboard.ts` (staleTasks 쿼리) + `costs.ts` (budget enforcement)
- **목적**: 방치된 태스크와 비용 폭주를 조기 감지.
- **구현**:
  - `in_progress` 상태 + `started_at`이 N시간 이상인 태스크를 "Stale" 경고로 표시
  - 에이전트별 월간 비용 한도 설정 (`budget_monthly_cents`)
  - 80% 도달 시 대시보드 경고 배지 + 텔레그램 알림
  - 100% 도달 시 빨간 경고 + 알림 (자동 정지는 OpenClaw 레벨에서 처리)
  - 대시보드 상단에 `pendingAlerts` 카운터 추가

#### F-005: SQLite Persistent Storage
- **출처**: 기존 BLACKBOARD.md 계획
- **목적**: 서버 재시작 시 데이터 유실 방지.
- **구현**:
  - `OBSERVATORY_DB_PATH` 환경 변수로 영구 DB 경로 지정
  - 기존 in-memory 모드를 폴백으로 유지
  - Docker Compose에서 볼륨 마운트 설정

---

### Phase 2 — Structure (구조화) | 예상: 2~3주

#### F-006: Goal Hierarchy
- **출처**: Paperclip `goals` 테이블 (company/team/agent/task 레벨)
- **목적**: "왜 이 일을 하는가?"를 추적. 모든 태스크가 상위 목표에 연결.
- **구현**:
  - `goals` 테이블 신설 (id, title, description, level, parent_id, status)
  - Source of Truth: `GOALS.md` 파일 파싱 (기존 erikas-dream/GOALS.md 호환)
  - `tasks` 테이블에 `goal_id` FK 추가
  - 프론트엔드: Goal → Project → Task 드릴다운 뷰
  - 대시보드에 "Goal Progress" 위젯 추가 (목표별 완료율 바)

#### F-007: Task Comments
- **출처**: Paperclip `issue_comments` 테이블
- **목적**: 태스크에 직접 컨텍스트를 기록하여 작업 맥락을 보존.
- **구현**:
  - `task_comments` 테이블 신설 (id, task_id, author_agent_id, body, created_at)
  - 에이전트가 작업 중 진행 상황/블로커를 코멘트로 남기는 API
  - 프론트엔드: 태스크 상세 패널에 코멘트 스레드 표시
  - **핵심 원칙**: "Tasks are the communication channel" — 텔레그램이 아닌 태스크가 소통의 채널.

#### F-008: Issue Relations & Dependencies
- **출처**: Paperclip `issue_relations` (blocks/blocked_by/related/duplicate) + 기존 F-002
- **목적**: 태스크 간 의존성을 명시적으로 관리하여 병목 파악.
- **구현**:
  - `task_relations` 테이블 (id, type, task_id, related_task_id)
  - 관계 유형: `blocks`, `blocked_by`, `related`
  - TASK.md 파서: `depends:T-001` 구문 인식
  - 프론트엔드: 의존성 화살표 또는 blocked 플래그 표시
  - 블로킹 태스크 완료 시 자동 플래그 해제

#### F-009: Agent Health & Context Monitoring
- **출처**: 기존 F-003 + Paperclip `agent_runtime_state`
- **목적**: 에이전트의 기술적 상태를 실시간 감시.
- **구현**:
  - 에이전트별 런타임 상태 테이블 (total_tokens, total_cost, last_error, last_run_status)
  - Context Window 점유율 게이지 (ACP 세션 연동 시)
  - 최근 N회 Tool Call 성공/실패율 게이지
  - 에이전트 카드에 건강 상태 배지 (🟢 정상 / 🟡 주의 / 🔴 에러)

#### F-010: Real-time Event Enhancement
- **출처**: Paperclip WebSocket + React Query invalidation 패턴
- **목적**: 대시보드의 실시간 반응성 향상.
- **구현**:
  - WebSocket 이벤트 타입 확장: `task.updated`, `task.checkout`, `agent.status`, `cost.alert`, `activity.logged`
  - React Query 캐시 무효화: 이벤트 수신 시 관련 쿼리만 선택적 invalidate
  - 연결 끊김 시 자동 재연결 + polling 폴백

---

### Phase 3 — Governance (거버넌스) | 예상: 3~4주

#### F-011: Web-based Approval Gate
- **출처**: Paperclip `approvals` + `approval_comments` + 기존 F-004
- **목적**: 위험 작업에 대한 인간 승인 절차를 웹에서 처리.
- **구현**:
  - `approvals` 테이블 (id, type, requested_by, status, payload, decision_note, decided_at)
  - 승인 유형: `dangerous_action`, `budget_override`, `new_agent`
  - 상태: `pending` → `approved` / `rejected` / `revision_requested`
  - 프론트엔드: 승인 요청 리스트 + Approve/Deny/Comment 버튼
  - 텔레그램 알림 연동 (승인 대기 알림)

#### F-012: Activity Log (감사 추적)
- **출처**: Paperclip `activity_log` (actor_type, action, entity_type, entity_id, details)
- **목적**: 모든 변경 이력을 추적하여 문제 발생 시 원인 분석 가능.
- **구현**:
  - 기존 `activities` 테이블 구조 확장: actor_type(agent/user/system), entity_type, entity_id 추가
  - 모든 mutating action(태스크 상태 변경, 체크아웃, 비용 기록 등)에서 자동 기록
  - 프론트엔드: Activity 타임라인 페이지 + 엔티티별 필터

#### F-013: Adapter Registry (플러거블 수집기)
- **출처**: Paperclip `ServerAdapterModule` 인터페이스
- **목적**: 새로운 에이전트 런타임을 표준화된 인터페이스로 연동.
- **구현**:
  - 기존 Collector 패턴을 `ObservatoryAdapter` 인터페이스로 리팩토링
  - 인터페이스: `type`, `capabilities`, `collect()`, `testConnection()`
  - capabilities: `{ costTracking, logStreaming, statusUpdates, sessionResume }`
  - 레지스트리에 등록: MissionControl, ClaudeCode, OpenClaw, OpenCode, (향후) Codex, Cursor

---

## 3. 테스트 전략

### 3.1 더미 데이터 시뮬레이터
- **위치**: `scripts/generate-dummy-data.js` (이미 생성됨)
- **역할**: 프로젝트 태그가 포함된 가상 태스크, 비용 이벤트, 활동 로그 자동 생성
- **확장 계획**: Phase별로 Goal, Comment, Relation 더미도 추가

### 3.2 E2E 테스트 시나리오
| Phase | 시나리오 | 검증 |
|-------|----------|------|
| 1 | 태스크 생성 → 프로젝트 필터링 | 프로젝트별 칸반 정상 표시 |
| 1 | 두 에이전트 동시 체크아웃 시도 | 409 Conflict 반환, 단일 점유 보장 |
| 1 | 비용 80% 도달 | 알림 배지 + 텔레그램 알림 |
| 2 | Goal → Project → Task 드릴다운 | 계층 탐색 정상 작동 |
| 2 | 블로킹 태스크 완료 | 피블로킹 태스크의 blocked 해제 |
| 3 | 승인 요청 → 웹에서 Approve | 에이전트에게 결과 전달 |

### 3.3 Dogfood 체크리스트
- [ ] Observatory 서버를 Docker로 배포하고 3일간 실제 운영
- [ ] Bart가 모바일에서 대시보드를 보고 프로젝트별 진척도 확인 가능
- [ ] Erika가 Stale Task 알림을 받고 에이전트에게 조치 지시 가능
- [ ] 비용 리포트에서 "moonlit에 총 $X 사용" 확인 가능

---

## 4. 마일스톤 요약

```
Phase 1 (Foundation)     Phase 2 (Structure)      Phase 3 (Governance)
─────────────────────    ─────────────────────    ─────────────────────
F-001 Project View       F-006 Goal Hierarchy     F-011 Approval Gate
F-002 Cost Tracking      F-007 Task Comments      F-012 Activity Log
F-003 Atomic Checkout    F-008 Dependencies       F-013 Adapter Registry
F-004 Stale/Budget       F-009 Agent Health
F-005 Persistent DB      F-010 Realtime Events
```

---

## 5. 참고 자료
- `agent-observatory/docs/PAPERCLIP-ANALYSIS.md` — Paperclip 심층 분석
- `agent-observatory/BLACKBOARD.md` — Observatory 현재 상황판
- Paperclip 소스: `/Users/bclaw/workspace/agentic/paperclip`
- Paperclip 스펙: `doc/SPEC.md`, `doc/SPEC-implementation.md`, `doc/spec/agent-runs.md`
