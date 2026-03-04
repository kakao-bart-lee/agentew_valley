# Agent Observatory

실시간 에이전트 활동 관찰 및 비주얼 시각화 웹서비스.

## 프로젝트 개요

다양한 AI 에이전트(Claude Code CLI, OpenClaw, Agent SDK, 기타)의 활동을 하나의 웹서비스에서 실시간 관찰. 대시보드 + 픽셀 캐릭터 시각화 제공.

## 아키텍처 요약

```
Data Sources → Collection Layer → Processing Layer → Delivery Layer → Presentation Layer
(JSONL/Hooks)  (Collectors)       (EventBus+State)   (WebSocket/REST)  (React Web App)
```

- **핵심 프로토콜**: UAEP-min (Universal Agent Event Protocol — 경량 버전)
- **모노레포**: pnpm workspace, 4개 패키지 (shared, collectors, server, web)
- **기술 스택**: TypeScript, Node.js, Express, Socket.IO, React, Canvas 2D

## 패키지 구조

```
packages/
├── shared/       — UAEP 타입, 도구 카테고리 매핑, 유틸리티 (모든 패키지의 기반)
├── collectors/   — 에이전트 소스별 수집기 (Claude Code JSONL, OpenClaw JSONL, SDK Hooks, HTTP)
├── server/       — 이벤트 버스, 상태 관리, 메트릭 집계, WebSocket/REST API
└── web/          — React 프론트엔드 (Dashboard, Pixel Office, Timeline 뷰) ← FE 팀 담당
```

## 설계 문서 위치

- 전체 아키텍처: `docs/agent-observatory-architecture_2026-02-27.md`
- FE 대시보드 스펙: `docs/FE-dashboard-spec_2026-02-27.md`
- 에이전트 로깅 연구: `docs/01_agent_session_logging_research_2026-02-27.md`
- 시각화 추상화 연구: `docs/02_visualization_abstraction_research_2026-02-27.md`
- 유사 사례 조사: `docs/03_swarm_team_dashboard_cases_2026-02-27.md`

## Migration 문서 규칙

- `docs/migration/`의 운영 가드레일 문서는 가능한 한 정량 검증 가능한 표를 사용 (`Target`, `Measurement Source`, `Alert Threshold`)
- SLO/신뢰성 문서에는 월간 error budget과 breach 시 rollback/완화 절차를 함께 명시
- 데이터 모델 경계 문서/스키마 변경 시 UAEP event store(append-only telemetry)와 ops domain store(authoritative workflow state)를 분리하고, 신규 ops 테이블에 `workspace_id`, `created_at`, `updated_at`, `actor` 공통 컬럼을 포함
- Backfill 설계 문서(`backfill-plan.md`)는 엔터티별 source->target 매핑, 필드 변환/널 처리 규칙, unsupported/skip code 정책을 함께 기록해 재실행 시 결정이 바뀌지 않도록 유지
- Backfill 설계 문서에서 idempotency는 `<entity>:<workspace_id>:<entity_id>:<operation>:<version_token>` 형식을 기본으로 하고, replay 정렬 기준(`version_token`, `source_sequence`, operation rank, primary id)과 create/update/delete conflict 해소 규칙을 함께 명시
- 리허설 검증은 `scripts/migration/rehearsal-check.sh`를 사용하며 입력 CSV 스키마를 고정(`entity,source_count,target_count` + `entity,diff_count`)하고 필수 엔터티(`tasks`,`reviews`,`notifications`,`activities`,`webhooks`) 누락/불일치를 실패로 처리
- Shadow comparator는 `packages/server/src/domains/migration/shadow-mode.ts`를 단일 진실 공급원으로 사용하고, 상태 enum(`match`,`mismatch`,`missing_legacy`,`missing_new`)과 `$.path` 기반 field diff 표기(객체 키 정렬 포함)를 유지해 리포트 결과를 결정적으로 만든다
- Migration shadow report API(`GET /api/v1/migration/shadow-report`)는 `shadowModeEnabled`가 꺼져 있으면 항상 `503 + SHADOW_MODE_DISABLED`를 반환하고, 켜져 있을 때 응답 키를 `pass_count`, `fail_count`, `top_diffs`(snake_case)로 고정한다
- Shadow mode env gating은 `packages/server/src/config/shadow-mode.ts`를 통해 처리하며, `OBSERVATORY_SHADOW_MODE_ENABLED` 기본값은 `false`, `OBSERVATORY_SHADOW_MODE_READ_ONLY` 기본값은 `true`; read-only가 아니면 `SHADOW_MODE_READ_ONLY_REQUIRED`로 차단한다
- Domain rollout feature flags는 `packages/server/src/config/feature-flags.ts`를 단일 진실 공급원으로 사용하고, canonical key(`auth_v2`,`tasks_v2`,`webhooks_v2`,`kill_switch_all_v2`) + env(`OBSERVATORY_*_V2_ENABLED`) + typed helper(`isFeatureFlagEnabled`/개별 accessor) 조합을 유지한다

## 개발 규칙

### 코드 스타일
- TypeScript strict mode 필수
- ESM (import/export) 사용 — CommonJS 금지
- 파일명: kebab-case (예: `tool-category.ts`)
- 타입: PascalCase (예: `AgentLiveState`)
- 함수/변수: camelCase
- 상수: UPPER_SNAKE_CASE

### 의존성 규칙
- `shared`는 외부 런타임 의존성 없음 (순수 타입 + 유틸)
- `collectors`는 `shared`에만 의존
- `server`는 `shared` + `collectors`에 의존
- `web`은 `shared`에만 의존 (서버 코드 직접 참조 금지)

### 테스트
- 모든 패키지: Vitest
- Collector parser/normalizer: 반드시 단위 테스트 작성
- 테스트 데이터: `__tests__/fixtures/` 디렉토리에 샘플 JSONL 파일
- pnpm v10 신규 환경에서는 `pnpm approve-builds`로 `better-sqlite3`, `esbuild` 빌드 스크립트를 먼저 승인해야 server 테스트에서 native binding 오류가 발생하지 않음

### Git
- 브랜치: `feat/{package}/{feature}` (예: `feat/collectors/openclaw-watcher`)
- 커밋 메시지: `{package}: {description}` (예: `shared: add UAEP-min type definitions`)

## 에이전트 스웜 구성 (Phase 1 백엔드)

3개 에이전트가 병렬로 작업. shared 패키지가 완성된 후 collectors와 server가 병렬 진행.

### Agent 1: "Shared" (기반 타입 에이전트)
- **작업 디렉토리**: `packages/shared/`
- **담당**: UAEP-min 타입 정의, AgentLiveState, MetricsSnapshot, 도구 카테고리 매핑, UUID v7, Zod 검증
- **우선순위**: 🔴 최우선 (다른 에이전트가 이 패키지에 의존)
- **완료 기준**: `pnpm --filter @agent-observatory/shared build` 성공 + 타입 export 확인

### Agent 2: "Collectors" (수집기 에이전트)
- **작업 디렉토리**: `packages/collectors/`
- **담당**: Claude Code JSONL Collector, OpenClaw JSONL Collector, Collector 기본 인터페이스
- **의존**: Agent 1(shared) 완료 후 시작
- **핵심 참고**: `docs/01_agent_session_logging_research_2026-02-27.md` — JSONL 파싱 규칙, 필드 매핑
- **완료 기준**: 실제 JSONL 파일로 파싱 테스트 통과

### Agent 3: "Server" (서버 에이전트)
- **작업 디렉토리**: `packages/server/`
- **담당**: EventBus(인메모리), StateManager, MetricsAggregator, WebSocket 서버, REST API
- **의존**: Agent 1(shared) 완료 후 시작. Collectors 연동은 마지막에.
- **완료 기준**: Mock 이벤트로 WebSocket 전송 + REST API 응답 확인

### 작업 순서 (의존성 그래프)

```
Phase 1-A (Day 1-2):
  [Agent 1: shared] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ✅
                     ↓ 완료 후
Phase 1-B (Day 3-5):
  [Agent 2: collectors] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ (병렬)
  [Agent 3: server]     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ (병렬)
                         ↓ 둘 다 완료 후
Phase 1-C (Day 6-7):
  [통합] Server + Collectors 연동 테스트 ━━━━━━━━━━━━━━ ✅
```

### 에이전트 간 계약 (Interface Contract)

Collectors → Server 연결 지점:
```typescript
// collectors가 export하는 것
export interface Collector {
  name: string;
  sourceType: AgentSourceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: UAEPEvent) => void): void;
}

// server가 Collector를 사용하는 방식
import { ClaudeCodeCollector } from '@agent-observatory/collectors';
const collector = new ClaudeCodeCollector({ watchPaths: ['~/.claude/projects'] });
collector.onEvent((event) => eventBus.publish(event));
await collector.start();
```

Server → Web(FE) 연결 지점:
```typescript
// WebSocket 이벤트 (server가 emit)
socket.emit('agent:state', agentLiveState);
socket.emit('agent:remove', { agent_id });
socket.emit('event', uaepEvent);
socket.emit('metrics:snapshot', metricsSnapshot);
socket.emit('init', { agents, metrics });

// REST API (server가 제공)
GET /api/v1/agents
GET /api/v1/agents/:id
GET /api/v1/agents/:id/events
GET /api/v1/metrics/summary
GET /api/v1/sessions
GET /api/v1/config
```
