# SPEC-004 (Revised): Agent Observatory — 순수 텔레메트리 레이어

- **Status**: APPROVED (revised 2026-03-08)
- **Author**: Bart + Erika
- **Supersedes**: `docs/S-004-observatory-evolution.md` (v1 — Paperclip 통합 계획)

---

## 1. 방향 전환 배경

### 1.1 원래 S-004 (v1)의 문제

원래 계획은 Observatory 안에 tasks, goals, approvals, comments 등을 직접 구현하는 것이었다. 이는 사실상 **Paperclip을 Observatory 내부에 복제**하는 것이다.

- Paperclip은 외부 프로젝트 — Observatory가 임의로 따라가면 schema drift 발생
- Observatory의 본질(텔레메트리)과 거버넌스 기능이 뒤섞임
- 두 시스템이 같은 데이터를 다른 방식으로 관리하는 중복 발생

### 1.2 새로운 원칙 (Revised)

**Observatory = "에이전트가 무엇을 했는가" (telemetry)**
**Paperclip = "에이전트가 무엇을 해야 하는가" (management)**

Observatory는 Paperclip의 내용을 복제하지 않는다.
대신 Paperclip이 주입하는 컨텍스트(task_id 등)를 이벤트에 부착하여 연결한다.

---

## 2. 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  Paperclip (외부 — 수정하지 않음)                              │
│  goals / tasks / approvals / comments / projects            │
│  "무엇을 해야 하는가" (management layer)                       │
└─────────────┬───────────────────────────────────────────────┘
              │
              │ 에이전트 spawn 시 환경변수 주입:
              │   OBSERVATORY_TASK_ID=T-123
              │   OBSERVATORY_PROJECT_ID=moonlit
              │   OBSERVATORY_GOAL_ID=G-001
              │
┌─────────────▼───────────────────────────────────────────────┐
│  Agent Runtime                                               │
│  Claude Code CLI / OpenCode / OpenClaw / Codex / ...        │
└─────────────┬───────────────────────────────────────────────┘
              │ UAEP Events (task_id, project_id, goal_id 포함)
┌─────────────▼───────────────────────────────────────────────┐
│  Agent Observatory (우리 것)                                  │
│                                                              │
│  Collection Layer                                            │
│    ClaudeCodeCollector / OpenCodeCollector / OpenClawCollector│
│    CodexCollector / HttpCollector                            │
│                                                              │
│  Processing Layer                                            │
│    EventBus / StateManager / MetricsAggregator              │
│    ContextEnricher (env var → event field mapping)          │
│                                                              │
│  Storage Layer (SQLite)                                      │
│    events / sessions / agent_runtime_state / cost            │
│                                                              │
│  Delivery Layer                                              │
│    WebSocket / REST API / Paperclip Adapter (read-only)     │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Paperclip과의 연결 방식

Observatory가 Paperclip을 알아야 하는 것은 **task 이름 조회(read-only)** 뿐이다.

```
task_id = "T-123" (이벤트에 포함)
    → Paperclip API: GET /api/tasks/T-123 → { title: "로그인 페이지 구현" }
    → Observatory UI에 이름 표시 (캐시, 선택적)
```

Observatory는 Paperclip의 tasks/goals/approvals를 직접 저장하거나 수정하지 않는다.

---

## 3. 컨텍스트 주입 방식

### 3.1 Paperclip 통해 spawn된 에이전트 (경로 1 — 기본)

Paperclip/OpenClaw가 에이전트를 실행할 때 환경변수를 주입한다:

```bash
OBSERVATORY_TASK_ID=T-123 \
OBSERVATORY_PROJECT_ID=moonlit \
OBSERVATORY_GOAL_ID=G-001 \
claude --resume ...
```

Collector가 에이전트 프로세스 또는 JSONL 로그에서 이 값을 읽어 모든 이벤트에 자동 부착한다. **에이전트 코드 수정 불필요.**

### 3.2 독립 실행 에이전트 (경로 2 — Paperclip 없이)

Codex, OpenCode 등을 Paperclip 없이 직접 실행하는 경우:

- 이벤트는 정상 수집됨 (cost, tokens, session replay 모두 기록)
- task_id / project_id = null
- UI에서 "Untracked" 버킷으로 분류

```
Paperclip 통해 실행:  event { task_id: "T-123", project_id: "moonlit" }
독립 실행:            event { task_id: null, project_id: null }  ← 수집은 됨
```

"Untracked" 세션은 오히려 유용한 신호다:
_"이 에이전트가 Paperclip 밖에서 얼마나, 무슨 일을 하고 있는가"_

---

## 4. S-004 v1 기능 재분류

| 기능 | v1 계획 | Revised 결정 | 이유 |
|------|---------|-------------|------|
| F-001 Project View | Observatory에 구현 | **Paperclip 담당** | 프로젝트는 Paperclip이 관리 |
| F-002 Cost Tracking | Observatory | **Observatory 유지** | 순수 텔레메트리 |
| F-003 Atomic Checkout | Observatory에 구현 | **Paperclip 담당** | 태스크 할당은 Paperclip 책임 |
| F-004 Budget Alert | Observatory | **Observatory 유지** | cost 데이터는 우리 것 |
| F-005 Persistent DB | Observatory | **Observatory 유지** | 인프라 |
| F-006 Goal Hierarchy | Observatory에 구현 | **Paperclip 담당** | 목표 관리는 Paperclip |
| F-007 Task Comments | Observatory에 구현 | **Paperclip 담당** | 소통 채널은 Paperclip |
| F-008 Dependencies | Observatory에 구현 | **Paperclip 담당** | 태스크 관계는 Paperclip |
| F-009 Agent Health | Observatory | **Observatory 유지** | 런타임 상태는 우리 것 |
| F-010 Realtime Events | Observatory | **Observatory 유지** | 텔레메트리 스트리밍 |
| F-011 Approvals | Observatory에 구현 | **Paperclip 담당** | 거버넌스는 Paperclip |
| F-012 Activity Log | Observatory에 구현 | **읽기 전용 참조** | Paperclip 이벤트를 Observatory가 표시 |
| F-013 Adapter Registry | Observatory | **Observatory 유지** | 수집기 인프라 |

---

## 5. 새로운 기능 목록 (Revised)

### Phase 1 — 멀티 런타임 수집 강화

#### R-001: OpenCode Collector
- **목적**: OpenCode ACP 에이전트 실시간 모니터링 (ADR-002)
- **구현**: `opencode.db` 폴링 (5초) → UAEP 이벤트 변환 → activity feed 통합
- **데이터**: `~/.local/share/opencode/opencode.db` (session, message, part 테이블)

#### R-002: Context Enrichment (환경변수 → 이벤트 컨텍스트)
- **목적**: Paperclip이 주입한 환경변수를 Collector가 읽어 이벤트에 자동 부착
- **구현**: Collector 공통 기반(`BaseCollector`)에 env var 읽기 추가
  - `OBSERVATORY_TASK_ID` → `event.task_id`
  - `OBSERVATORY_PROJECT_ID` → `event.project_id`
  - `OBSERVATORY_GOAL_ID` → `event.goal_id`
- **대상**: ClaudeCodeCollector, OpenClawCollector, OpenCodeCollector 전체 적용

#### R-003: Codex Collector (선택)
- **목적**: OpenAI Codex 에이전트 활동 수집
- **구현**: Codex 로그 형식 파악 후 파서 구현 (F-013 Adapter Registry 선행)

#### R-004: Untracked Session 처리
- **목적**: Paperclip 컨텍스트 없이 실행된 세션을 명시적으로 관리
- **구현**:
  - `project_id = null` 세션을 "Untracked" 그룹으로 UI 표시
  - Untracked 세션의 cost/token 합계 별도 집계
  - (선택) 사후에 task_id를 수동 태깅하는 API

### Phase 2 — 거버넌스 연동 (읽기 전용)

#### R-005: Paperclip Adapter (읽기 전용)
- **목적**: Observatory UI에서 task/project 이름을 Paperclip에서 조회
- **구현**:
  - `PaperclipAdapter`: `GET /api/tasks/:id`, `GET /api/projects/:id` 캐시 조회
  - 환경변수 `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`로 설정
  - 미연동 시: task_id 원문 그대로 표시 (graceful degradation)
- **중요**: Observatory는 Paperclip 데이터를 **저장하지 않음** — 표시 전용

#### R-006: Agent Health Dashboard 강화
- **목적**: 에이전트 건강 상태를 task 컨텍스트와 함께 표시
- **구현**: `agent_runtime_state` + Paperclip task 이름 조합 표시
  - 현재 작업 중인 task: Paperclip에서 이름 조회
  - Context window 점유율, tool call 성공률 게이지

#### R-007: Realtime Event Enhancement
- **목적**: WebSocket 이벤트 타입 확장
- **구현**:
  - `task.context` — Paperclip task_id 변경 시 브로드캐스트
  - `cost.alert` — 예산 80%/100% 도달 알림
  - `agent.health` — 건강 상태 변경 알림

---

## 6. DB 스키마 정리 방향

현재 `history-store.ts`에 Paperclip 복제용으로 만들어진 테이블들:

```sql
-- 아래 테이블들은 장기적으로 불필요 (Paperclip이 관리)
tasks           -- Paperclip 담당
goals           -- Paperclip 담당
task_comments   -- Paperclip 담당
task_relations  -- Paperclip 담당
approvals       -- Paperclip 담당
```

**단기 전략**: 테이블은 유지하되 신규 기능 추가 중단. MissionControlCollector(`TASK.md` watcher)는 Paperclip Adapter(R-005)로 대체 예정.

**유지할 테이블**:
```sql
events              -- 핵심 텔레메트리
sessions            -- 세션 메타데이터
agent_runtime_state -- 에이전트 건강 상태
agent_profiles      -- 예산 설정
activities          -- 텔레메트리 활동 로그
notifications       -- 예산 알림
```

---

## 7. 구현 우선순위

```
Week 1:
  [R-001] OpenCode Collector     ← ADR-002, 이미 계획됨
  [R-002] Context Enrichment     ← 환경변수 → 이벤트 자동 부착

Week 2:
  [R-004] Untracked Session UI   ← null context 세션 처리
  [R-007] Realtime Event 확장    ← WebSocket 이벤트 추가

Week 3+:
  [R-005] Paperclip Adapter      ← 읽기 전용 연동
  [R-006] Agent Health 강화
  [R-003] Codex Collector        ← 형식 파악 후
```

---

## 8. 변경되지 않는 것

- ADR-001: Hybrid Storage Model (Files → SQLite read model) — 유지
- ADR-002: OpenCode ACP Observability — 유지 (R-001로 구현)
- Bearer token 인증 (`OBSERVATORY_DASHBOARD_API_KEY`) — 유지
- WebSocket 실시간 업데이트 구조 — 유지
- Docker 단일 컨테이너 배포 — 유지

---

## 9. 참고

- `docs/S-004-observatory-evolution.md` — v1 원본 (Paperclip 통합 계획, 참고용 보존)
- `agent-observatory/BLACKBOARD.md` — 현재 구현 상황판
- `agent-observatory/docs/agent-observatory-architecture_2026-02-27.md` — 기존 아키텍처
- Paperclip: `/Users/bclaw/workspace/agentic/paperclip` — 외부 프로젝트, 직접 수정 금지
