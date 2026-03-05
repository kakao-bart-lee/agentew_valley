# Observatory Dev Group: Mission Status

## 🎯 Current Focus: ACP Agent Observability Integration
Local Linear 구축 완료 단계. 다음 목표: ACP 에이전트 실시간 모니터링 추가.

## 📋 Status Overview
- **Project Path**: `/Users/bclaw/workspace/agentic/agentew_valley/agent-observatory`
- **Phase**: Feature Expansion — ACP Agent Observability
- **Production**: `localhost:3010` (직접 실행), Docker 컨테이너 배포 진행 중

## ✅ 완료된 것
- Hybrid Storage Model (Files → SQLite read model)
- `/api/v2/tasks`, `/api/v2/activities`, `/api/v2/notifications` API
- MissionControlCollector (TASK.md watcher)
- Mission Control Kanban View (프론트엔드)
- Bearer token auth (`OBSERVATORY_DASHBOARD_API_KEY`)
- WebSocket 실시간 업데이트
- Single-container Docker 배포 구성 (`Dockerfile`, `docker-compose.yml`)
- Dogfood 완료 (ISSUE-001, ISSUE-002 수정)

## 🏗️ Architecture Decisions (ADR)

### ADR-001: Hybrid Storage Model [APPROVED]
- Files (TASK.md, *.jsonl) = Source of Truth
- SQLite = Read Model / Index
- Background collector가 파일 변경 감지 → SQLite sync

### ADR-002: ACP Agent Observability [NEW - 2026-03-05]
- **Context**: OpenCode ACP 에이전트들이 실행 중이지만 내부 상태를 볼 방법이 없었음.
- **발견**: OpenCode는 `~/.local/share/opencode/opencode.db` (SQLite)에 모든 세션/메시지를 기록.
  - `session` 테이블: 세션 목록, 제목
  - `message` 테이블: role별 메시지
  - `part` 테이블: 실제 text, tool-use, tool-result 내용
- **연결 고리**: `~/.openclaw/agents/opencode/sessions/sessions.json`의 `acpxRecordId` (= `ses_xxx`) →  `opencode.db`의 `session.id`로 직접 매핑 가능.
- **Decision**: `OpenCodeCollector` 추가 — `opencode.db`를 주기적으로 폴링하여 ACP 세션의 최신 활동을 o11y Activity Feed에 통합.
- **Status**: APPROVED, 구현 예정.

## 🔭 ACP Observability 구현 계획

### 데이터 소스
```
~/.openclaw/agents/opencode/sessions/sessions.json
  → acpxRecordId: "ses_xxx" (OpenCode session ID)
  → label: "moonlit-mastra-v3"
  → state: "running" | "idle"

~/.local/share/opencode/opencode.db
  → part 테이블: session_id, data (JSON: type, text, toolName 등)
  → 실시간 tool call, 응답 내용 포함
```

### 새로 추가할 컴포넌트
1. **`OpenCodeCollector`** (`packages/collectors/src/opencode/`)
   - `sessions.json` watch → 활성 ACP 세션 목록 파악
   - `opencode.db` 폴링 (5초 간격) → 각 세션의 최신 `part` 추출
   - `activity.new` 이벤트 emit → HistoryStore에 저장

2. **ACP Agent Card** (프론트엔드)
   - Session 목록에 ACP 에이전트 구분 표시
   - 마지막 tool call / 현재 실행 중인 작업 표시
   - running / idle / done 상태 배지

3. **`GET /api/v2/acp-sessions`** (선택)
   - 현재 활성 ACP 세션 + 마지막 활동 요약

## 👥 Team Assignments
- **Backend**: OpenCodeCollector 구현, opencode.db 스키마 연동
- **Frontend**: ACP Agent Card 컴포넌트, Activity Feed 통합
- **Erika**: 코디네이션

## 🚀 Next Steps
1. [ ] Observatory Docker 배포 완료 (진행 중)
2. [ ] `OpenCodeCollector` 구현
3. [ ] ACP Agent Card 프론트엔드
4. [ ] `fetchWithAuth()` 마이그레이션 (나머지 fetch 호출들)
5. [ ] SQLite 영구 저장 (`OBSERVATORY_DB_PATH` 항상 설정)
