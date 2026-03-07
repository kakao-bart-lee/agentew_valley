# S-007: 통합 텔레메트리 파이프라인 — AIS Pulse + collect-tokens + Agent Observatory 통합

> **작성일**: 2026-03-08
> **상태**: Proposed
> **관련 시스템**: AIS Pulse (`codeb/ais-pulse`), collect-tokens.py, Agent Observatory (`agentic/agentew_valley/agent-observatory`)

---

## 1. 배경 및 동기

현재 에이전트 관측/수집을 위한 시스템이 3개로 파편화되어 있다.

| 시스템 | 위치 | 역할 | 상태 |
|---|---|---|---|
| **AIS Pulse** | `codeb/ais-pulse` | 오케스트레이터 + 워크트리 세션 모니터링 + 토큰 API | 운영 중 |
| **collect-tokens.py** | `codeb/ais-pulse/scripts/` | OpenClaw/Codex/Claude Code 토큰 수집 → resume push | 운영 중 |
| **Agent Observatory** | `agentic/agentew_valley/agent-observatory` | 범용 에이전트 관측 플랫폼 (UAEP 표준, 다중 소스, 실시간) | 빌드 완료, 미운영 |

### 문제점

1. **중복 수집**: collect-tokens.py와 Observatory collectors가 동일한 소스(Claude Code, OpenClaw)를 각자 파싱
2. **데이터 단절**: AIS Pulse의 워크트리 세션 데이터가 Observatory와 분리
3. **API 분산**: 토큰 데이터는 AIS Pulse `/api/tokens`에, 에이전트 상태는 Observatory `/api/v1/agents`에 별도 존재
4. **운영 부담**: 3개 시스템을 각각 관리

### 기회

Agent Observatory가 이미 갖춘 인프라:
- **7개 collector**: Claude Code, OpenClaw, OMX, OpenCode, Agent SDK, HTTP, Mission Control
- **UAEP 표준 이벤트**: 소스 독립적 정규화 완료
- **MetricsAggregator**: 토큰/비용/도구 호출 실시간 집계 (SQLite 영속 포함)
- **WebSocket 실시간 스트리밍**: 이벤트 버스 → 클라이언트 push
- **웹 대시보드**: 에이전트 카드, 비용 차트, 토큰 차트, 픽셀 시각화

---

## 2. 목표

하나의 서버(Agent Observatory)에서 모든 에이전트 텔레메트리를 수집, 집계, 시각화, 외부 push.

```
┌──────────────────────────────────────────────────────────────────┐
│  Agent Observatory (통합 서버)                                    │
│                                                                  │
│  ┌─ Collectors ─────────────────────────────────────────────┐   │
│  │  claude-code/   ← ~/.claude/projects/**/*.jsonl          │   │
│  │  openclaw/      ← ~/.openclaw/agents/**/sessions/*.jsonl │   │
│  │  codex/         ← ~/.codex/sessions/**/*.jsonl   [신규]  │   │
│  │  omx/           ← OMX tmux 세션                          │   │
│  │  opencode/      ← ~/.opencode/ 세션                      │   │
│  │  ais-worktree/  ← /tmp/ais_workspaces/           [신규]  │   │
│  │  paperclip/     ← Paperclip DB (heartbeat_runs)  [신규]  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│                    UAEP Events                                   │
│                          ▼                                       │
│  ┌─ Core ───────────────────────────────────────────────────┐   │
│  │  EventBus → StateManager → MetricsAggregator             │   │
│  │                              ├─ SQLite 영속              │   │
│  │                              └─ 분당/시간당 윈도우       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│              ┌───────────┼───────────┐                          │
│              ▼           ▼           ▼                           │
│         REST API    WebSocket   Push Hook                        │
│         /api/v1/*   실시간       resume site                     │
│                                 (민감정보 필터)                   │
│                                                                  │
│  ┌─ Web ────────────────────────────────────────────────────┐   │
│  │  Dashboard (기존) + AIS Session Explorer (이식) +         │   │
│  │  Token Analytics (기존) + Pixel Canvas (기존)             │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘

         ┌──────────────────────────────────┐
         │  Resume Site (외부 공개)          │
         │  POST /api/tokens ← Push Hook    │
         │  (민감 정보 제외 토큰 집계만)     │
         └──────────────────────────────────┘
```

---

## 3. 작업 항목

### Phase 1: 신규 Collector 추가 (수집 통합)

#### 3.1 CodexCollector — `packages/collectors/src/codex/`

**소스**: `~/.codex/sessions/**/*.jsonl` (rollout 파일)

**파싱 대상**:
| rollout event type | 추출 데이터 | UAEP 매핑 |
|---|---|---|
| `session_meta` | `model_provider`, `cli_version`, `cwd`, `source` | `session.start` |
| `turn_context` | `model`, `timezone`, `approval_policy` | `session.model_change` |
| `response_item` (role: user) | 사용자 입력 | `user.input` |
| `response_item` (role: assistant) | 에이전트 응답 | `agent.response` |
| `event_msg` (type: token_count) | `total_token_usage.{input,output,reasoning,cached}` | `metrics.token_usage` |
| `event_msg` (type: token_count) | `rate_limits.{used_percent,window_minutes}` | `metrics.rate_limit` |

**구현 참고**: `collect-tokens.py`의 `collect_codex()` 로직을 TypeScript로 이식.

**파일 구조**:
```
packages/collectors/src/codex/
  index.ts       — CodexCollector (Collector 인터페이스 구현)
  parser.ts      — rollout JSONL 파싱 (session_meta, event_msg 등)
  normalizer.ts  — Codex record → UAEPEvent 변환
  watcher.ts     — 파일시스템 감시 (chokidar, 기존 패턴 따름)
```

**테스트**: `packages/collectors/src/__tests__/codex-parser.test.ts`, `codex-normalizer.test.ts`

---

#### 3.2 AISWorktreeCollector — `packages/collectors/src/ais-worktree/`

**소스**: `/tmp/ais_workspaces/<IDENTIFIER>/agent.log`

**파싱 대상** (AIS Pulse `ais-status.ts` 로직 이식):
| 데이터 | UAEP 매핑 |
|---|---|
| 워크트리 디렉토리 존재 | `session.start` |
| `agent.log` ANSI 스트립 → 라인 파싱 | `agent.activity` |
| blocker 패턴 감지 (`error:`, `failed`, `blocked`) | `agent.blocker` |
| `WORKFLOW.md` 이슈 식별자 추출 | `session.metadata` (issueIdentifier, title) |
| `.git` worktree HEAD 파싱 | `session.metadata` (branchName) |
| 디렉토리 삭제 감지 | `session.end` |

**구현 참고**: `ais-status.ts`의 `buildSession()`, `extractBlockers()`, `inferThinkingState()` 등을 collector 패턴으로 리팩토링.

**파일 구조**:
```
packages/collectors/src/ais-worktree/
  index.ts       — AISWorktreeCollector
  parser.ts      — agent.log 파싱, 이슈 프롬프트 추출
  watcher.ts     — /tmp/ais_workspaces/ 디렉토리 감시
```

---

#### 3.3 PaperclipCollector — `packages/collectors/src/paperclip/`

**소스**: Paperclip PostgreSQL (`127.0.0.1:54329`)

**수집 대상**:
| 테이블 | 데이터 | UAEP 매핑 |
|---|---|---|
| `heartbeat_runs` | 에이전트별 실행 기록, 상태 변화 | `session.start/end`, `agent.status_change` |
| `issues` | 이슈 상태 변경 | `task.status_change` |
| `agents` | 에이전트 상태 (idle/busy/paused) | `agent.status_change` |

**수집 방식**: 30초마다 폴링 (REST API `http://127.0.0.1:3100/api/` 또는 직접 DB 쿼리)

**우선순위**: Phase 2 (heartbeat_runs에 토큰 로그 컬럼 추가 후 활성화)

---

### Phase 2: 기존 기능 흡수

#### 3.4 AIS Pulse 웹 UI → Observatory `packages/web/` 통합

**이식 대상**:
| AIS Pulse 컴포넌트 | Observatory 위치 | 비고 |
|---|---|---|
| `session-explorer.tsx` | `views/AIS/SessionExplorer.tsx` | 세션 목록, 블로커, 상태 |
| `live-log-stream.tsx` | `views/AIS/LiveLogStream.tsx` | 실시간 로그 tail |
| `dashboard-shell.tsx` | `views/Dashboard/` 내 탭으로 통합 | 네비게이션 |
| `help-panel.tsx` | `components/HelpPanel.tsx` | 공통 컴포넌트 |

**API 매핑**:
| AIS Pulse API | Observatory API |
|---|---|
| `GET /api/status` | `GET /api/v1/agents` + AIS 필터 |
| `GET /api/logs/:sessionId` | `GET /api/v1/sessions/:id/transcript` |
| `GET /api/tokens` | `GET /api/v1/metrics/summary` (이미 존재) |
| `POST /api/tokens` | 불필요 (collector가 직접 수집) |

#### 3.5 collect-tokens.py → Push Hook으로 대체

**현재**: LaunchAgent (5분) → `openclaw sessions --json` → Python 파싱 → POST resume site

**이후**: Observatory server의 이벤트 훅으로 대체

```typescript
// packages/server/src/delivery/hooks.ts (기존 파일 확장)
export function registerResumeHook(eventBus: EventBus, config: ResumeHookConfig) {
  let buffer: TokenDelta[] = [];

  // 5분마다 resume site로 push
  setInterval(async () => {
    if (buffer.length === 0) return;
    const aggregated = aggregateByProviderModel(buffer);
    await pushToResume(config.resumeUrl, aggregated);
    buffer = [];
  }, config.intervalMs ?? 300_000);

  // token_usage 이벤트 수신
  eventBus.on('metrics.token_usage', (event) => {
    buffer.push({
      source: event.source,
      provider: event.data?.provider,
      model: event.data?.model,
      input: event.data?.input_tokens ?? 0,
      output: event.data?.output_tokens ?? 0,
    });
  });
}
```

**민감 정보 필터**: resume push 시 다음만 포함
- provider, model, input_tokens, output_tokens, source
- 세션 내용, 파일 경로, API 키 등은 제외

---

### Phase 3: AIS Pulse 오케스트레이터 분리

#### 3.6 orchestrator.py 독립 유지

`orchestrator.py`는 **수집이 아닌 실행(dispatch)** 역할이므로 Observatory에 흡수하지 않는다.

```
orchestrator.py (독립 유지)
  - Linear ad 이슈 감지 → Paperclip 미러링
  - Paperclip 상태 → Linear 역동기화
  - 실행 로직만 담당, 관측은 하지 않음

Agent Observatory
  - orchestrator가 생성한 /tmp/ais_workspaces/ 를 AISWorktreeCollector로 관측
  - 오케스트레이터 자체의 로그도 수집 가능 (/tmp/orchestrator.log)
```

---

## 4. 마이그레이션 계획

```
Week 1: Phase 1 — CodexCollector + AISWorktreeCollector 구현
  ├── codex/ parser, normalizer, watcher, tests
  ├── ais-worktree/ parser, watcher, tests
  └── Observatory 서버 기동 테스트 (모든 collector 활성화)

Week 2: Phase 2 — UI 통합 + Resume Push Hook
  ├── AIS Session Explorer → Observatory web 이식
  ├── Resume push hook 구현 (hooks.ts)
  ├── collect-tokens.py LaunchAgent 비활성화
  └── AIS Pulse dev server 비활성화 (Observatory가 대체)

Week 3: Phase 3 — 안정화 + PaperclipCollector
  ├── Paperclip collector 기본 구현
  ├── Observatory LaunchAgent 등록
  └── AIS Pulse 아카이브 (orchestrator.py만 잔류)
```

---

## 5. 최종 아키텍처

```
서비스                   포트    역할
─────────────────────────────────────────────────
Agent Observatory        4000   통합 관측 (수집 + 집계 + 시각화 + push)
orchestrator.py          -      Linear↔Paperclip 미러링 (백그라운드 데몬)
Resume site              3001   외부 공개용 (토큰 집계만 수신)
Paperclip                3100   에이전트 실행 관리 (기존 유지)
OpenClaw Gateway         8787   대화 세션 관리 (기존 유지)
```

---

## 6. 폐기 대상

| 대상 | 시점 | 대체 |
|---|---|---|
| AIS Pulse dev server (:3000) | Phase 2 완료 후 | Observatory web |
| `scripts/collect-tokens.sh` + `.py` | Phase 2 완료 후 | Observatory push hook |
| `dev.erika.collect-tokens` LaunchAgent | Phase 2 완료 후 | Observatory 자체 스케줄 |
| `ais-pulse/src/lib/ais-status.ts` | Phase 1 완료 후 | AISWorktreeCollector |
| `ais-pulse/src/app/api/tokens/` | Phase 2 완료 후 | Observatory `/api/v1/metrics/` |

**잔류**: `orchestrator.py`는 `codeb/ais-pulse/`에 그대로 유지 (관측과 무관한 실행 도구)

---

## 7. 리스크

| 리스크 | 경감 |
|---|---|
| Observatory가 아직 실행 검증 안 됨 | Phase 1에서 먼저 서버 기동 테스트 |
| better-sqlite3 네이티브 모듈 빌드 | `pnpm install` 시 확인 |
| Codex rollout 스키마 변경 | 방어적 파싱 (unknown 필드 무시) |
| 워크트리 감시 성능 (chokidar) | depth 제한 + 디바운스 |

---

## 8. 성공 기준

- [ ] Observatory 서버 단일 프로세스로 OpenClaw + Codex + Claude Code + AIS worktree 데이터 수집 확인
- [ ] 대시보드에서 provider/model별 토큰 집계 + 에이전트 상태 + 세션 로그 통합 표시
- [ ] Resume site가 Observatory push hook에서만 데이터 수신 (collect-tokens.py 폐기)
- [ ] AIS Pulse dev server 제거 후 기능 손실 없음
