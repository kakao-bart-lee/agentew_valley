# Agent Observatory — 스웜 실행 가이드

## 개요

3개의 Claude Code 에이전트를 병렬로 실행하여 백엔드를 구축합니다.
FE(web 패키지)는 이 가이드에 포함되지 않습니다.

```
Agent 1: "Shared"      → packages/shared/     (기반 타입)
Agent 2: "Collectors"   → packages/collectors/ (수집기)
Agent 3: "Server"       → packages/server/     (서버)
```

---

## 사전 준비

```bash
# 프로젝트 루트에서
cd agent-observatory

# 의존성 설치
pnpm install

# shared를 먼저 빌드할 수 있도록 확인
pnpm --filter @agent-observatory/shared build  # (소스가 없으면 실패 — 정상)
```

---

## Phase 1-A: Agent 1 (Shared) — 단독 실행

Shared 패키지가 완성되어야 다른 에이전트가 시작할 수 있습니다.

### 터미널 1

```bash
cd agent-observatory

claude --dangerously-skip-permissions \
  -p "너는 Agent Observatory 프로젝트의 'Shared' 에이전트야.
packages/shared/ 디렉토리에서 작업해.
packages/shared/CLAUDE.md를 읽고 그 안의 구현 태스크를 순서대로 모두 완료해.
완료 후 pnpm --filter @agent-observatory/shared build && pnpm --filter @agent-observatory/shared test 를 실행해서 전체 통과를 확인해."
```

### 완료 확인

```bash
# 빌드 확인
pnpm --filter @agent-observatory/shared build

# 테스트 확인
pnpm --filter @agent-observatory/shared test

# 타입 export 확인 (dist/ 디렉토리에 .d.ts 파일들)
ls packages/shared/dist/
```

**Shared가 통과하면 Phase 1-B로 진행합니다.**

---

## Phase 1-B: Agent 2 + Agent 3 — 병렬 실행

두 에이전트를 **별도 터미널**에서 동시에 실행합니다.

### 터미널 2 — Agent 2 (Collectors)

```bash
cd agent-observatory

claude --dangerously-skip-permissions \
  -p "너는 Agent Observatory 프로젝트의 'Collectors' 에이전트야.
packages/collectors/ 디렉토리에서 작업해.
packages/collectors/CLAUDE.md를 읽고 그 안의 구현 태스크를 순서대로 모두 완료해.
참고 문서: docs/01_agent_session_logging_research_2026-02-27.md (JSONL 파싱 규칙)
완료 후 pnpm --filter @agent-observatory/collectors build && pnpm --filter @agent-observatory/collectors test 를 실행해서 전체 통과를 확인해."
```

### 터미널 3 — Agent 3 (Server)

```bash
cd agent-observatory

claude --dangerously-skip-permissions \
  -p "너는 Agent Observatory 프로젝트의 'Server' 에이전트야.
packages/server/ 디렉토리에서 작업해.
packages/server/CLAUDE.md를 읽고 그 안의 구현 태스크를 순서대로 모두 완료해.
참고 문서: docs/agent-observatory-architecture_2026-02-27.md (§7, §8)
Collector 연동(src/index.ts)은 마지막에 구현하되, Collector가 아직 완성 안 됐으면 mock으로 대체해.
완료 후 pnpm --filter @agent-observatory/server build && pnpm --filter @agent-observatory/server test 를 실행해서 전체 통과를 확인해."
```

### 병렬 실행 모니터링

```bash
# 각 터미널의 진행 상황 확인
# Agent 2, 3은 서로 독립적이므로 순서 무관하게 진행됨
# 둘 다 shared 패키지만 의존 — 이미 빌드 완료 상태

# 빌드 확인 (각각)
pnpm --filter @agent-observatory/collectors build
pnpm --filter @agent-observatory/server build
```

---

## Phase 1-C: 통합 확인

두 에이전트가 모두 완료되면 전체 빌드 + 통합 테스트를 실행합니다.

### 전체 빌드

```bash
# 루트에서 전체 빌드
pnpm build

# 전체 테스트
pnpm test
```

### 통합 테스트 (수동)

```bash
# 서버 시작
cd packages/server
pnpm dev
# → http://localhost:3000 에서 서버 실행

# 다른 터미널에서 API 테스트
curl http://localhost:3000/api/v1/agents
curl http://localhost:3000/api/v1/metrics/summary

# WebSocket 테스트 (wscat 사용)
npx wscat -c ws://localhost:3000
# 연결 시 'init' 이벤트 수신 확인
```

### E2E 흐름 확인

서버가 실행 중일 때, Claude Code를 사용하면 Collector가 JSONL을 감지하고
이벤트가 WebSocket으로 전달되는 것을 확인할 수 있습니다.

```
Claude Code 사용
  → ~/.claude/projects/**/*.jsonl에 기록
  → ClaudeCodeCollector가 감지
  → parser → normalizer → UAEPEvent
  → eventBus.publish()
  → StateManager 업데이트
  → WebSocket 'agent:state' 이벤트
  → REST API /api/v1/agents에 반영
```

---

## 트러블슈팅

### "Cannot find module '@agent-observatory/shared'"
→ shared 빌드가 안 된 상태. `pnpm --filter @agent-observatory/shared build` 먼저 실행.

### Collector가 파일 감지를 못 하는 경우
→ watchPaths 확인. Claude Code 기본 경로: `~/.claude/projects/`
→ NFS/원격 파일시스템이면 chokidar의 `usePolling: true` 옵션 필요.

### TypeScript 에러: 프로젝트 레퍼런스 문제
→ `pnpm build` (루트)로 전체 빌드하면 tsconfig references 순서대로 빌드됨.

### 에이전트가 다른 패키지 파일을 수정하려는 경우
→ 각 에이전트는 자기 패키지 디렉토리만 수정해야 합니다.
→ shared 타입을 변경해야 하면, Agent 1을 다시 실행하세요.

---

## 대안: 단일 에이전트 순차 실행

병렬 실행이 어려우면, 하나의 에이전트로 순차 실행할 수 있습니다:

```bash
claude --dangerously-skip-permissions \
  -p "Agent Observatory 프로젝트의 백엔드를 구현해.
다음 순서대로 작업해:
1. packages/shared/CLAUDE.md 읽고 shared 패키지 구현 → 빌드+테스트
2. packages/collectors/CLAUDE.md 읽고 collectors 패키지 구현 → 빌드+테스트
3. packages/server/CLAUDE.md 읽고 server 패키지 구현 → 빌드+테스트
4. 전체 pnpm build && pnpm test 통과 확인"
```

이 방식은 더 느리지만, 컨텍스트 공유가 자연스러워 에이전트 간 조율 문제가 없습니다.

---

## 다음 단계

백엔드 Phase 1이 완료되면:

1. **FE 에이전트 팀 투입**: `docs/FE-dashboard-spec_2026-02-27.md`를 기반으로 `packages/web/` 구현
2. **통합**: 서버 실행 + FE 개발 서버 → 실시간 대시보드 확인
3. **Phase 2**: Pixel Office 뷰, 타임라인 뷰, 히스토리 저장소 등
