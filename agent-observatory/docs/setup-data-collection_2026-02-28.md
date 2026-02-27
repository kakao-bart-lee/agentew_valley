# Agent Observatory — 데이터 수집 설정 가이드

> 작성일: 2026-02-28
> 대상: Agent Observatory 서버에 Claude Code / OpenClaw 에이전트 데이터를 연결하는 개발자

---

## 개요

Agent Observatory는 두 가지 방식으로 에이전트 데이터를 수집합니다.

| 수집 방식 | 소스 | 설정 위치 |
|----------|------|----------|
| **JSONL 파일 감시** | Claude Code, OpenClaw | 서버 환경변수 |
| **HTTP Hooks** | Claude Code | `~/.claude/settings.json` |

- **JSONL 감시**: 에이전트가 기록하는 로그 파일을 서버가 tail 방식으로 실시간 읽음. 에이전트 측 설정 불필요.
- **HTTP Hooks**: Claude Code가 각 생명주기 이벤트 발생 시 서버로 직접 HTTP POST 전송. `settings.json`에 URL 등록 필요.

두 방식은 **독립적**이므로 하나만 사용해도 되고 둘 다 활성화해도 됩니다.

---

## 1. 서버 시작

```bash
# 프로젝트 루트에서
pnpm --filter @agent-observatory/server start

# 또는 개발 모드
pnpm --filter @agent-observatory/server dev
```

기본 포트: **3000**
엔드포인트: `http://localhost:3000`

### 주요 환경변수

```bash
# 서버 포트 (기본: 3000)
PORT=3000

# Claude Code JSONL 감시 경로 (기본: ~/.claude/projects)
CLAUDE_CODE_WATCH_PATHS=~/.claude/projects

# OpenClaw JSONL 감시 경로 (기본: ~/.openclaw/agents)
OPENCLAW_WATCH_PATHS=~/.openclaw/agents

# 기존 파일 건너뜀 여부 (기본: true = 서버 시작 후 새로 추가된 내용만 수집)
# false로 설정하면 기존 파일의 전체 내용을 처음부터 읽음
OBSERVATORY_TAIL_ONLY=true

# 운영 모드 (기본: local)
# local: 로컬 파일 감시 + HTTP 훅 수신
# remote: HTTP 훅 수신만
OBSERVATORY_MODE=local
```

---

## 2. Claude Code 설정

### 2-A. JSONL 파일 감시 (자동)

Claude Code는 `~/.claude/projects/` 하위에 대화 세션을 JSONL 파일로 자동 저장합니다.
서버의 `CLAUDE_CODE_WATCH_PATHS` 환경변수가 이 경로를 가리키면 별도 설정 없이 수집됩니다.

```
~/.claude/projects/
└── -Users-joy-myproject/      ← 프로젝트별 디렉토리
    ├── abc123.jsonl           ← 세션 파일 (자동 감시)
    └── def456.jsonl
```

**수집 가능한 데이터**: 도구 호출/완료, 사용자 입력, 세션 시작/종료
**미수집**: LLM 모델 ID (JSONL에 포함 안 됨 → HTTP Hooks 필요)

---

### 2-B. HTTP Hooks 설정 (권장 — 모델 데이터 포함)

HTTP Hooks를 사용하면 **LLM 모델 ID, 도구 실패 원인, 서브에이전트 정보** 등 JSONL에 없는 데이터를 추가로 수집할 수 있습니다.

#### 설정 파일 위치

```
~/.claude/settings.json          ← 전역 설정 (모든 프로젝트에 적용)
.claude/settings.json            ← 프로젝트별 설정 (해당 프로젝트에만 적용)
```

#### 권장 설정 (전체 훅)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ]
  }
}
```

#### 최소 설정 (모델 정보만 필요한 경우)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:3000/api/v1/hooks/claude-code"
          }
        ]
      }
    ]
  }
}
```

#### 각 훅이 수집하는 데이터

| 훅 이름 | 이벤트 타입 | 수집 데이터 |
|---------|-----------|------------|
| `SessionStart` | `session.start` | `model_id` (예: `claude-sonnet-4-6`), `agent_type` |
| `Stop` | `session.end` | `last_assistant_message_length`, `stop_hook_active` |
| `PostToolUse` | `tool.end` | `tool_name`, `input_keys`*, `response_length` |
| `PostToolUseFailure` | `tool.error` | `tool_name`, `error`, `is_interrupt` |
| `SubagentStart` | `subagent.spawn` | `child_agent_id`, `agent_type` |
| `SubagentStop` | `subagent.end` | `child_agent_id`, `last_assistant_message_length` |

> \* **개인정보 보호**: `tool_input`의 값은 저장하지 않습니다. 파라미터 이름(`input_keys`)만 기록합니다.
> 예: `{ "file_path": "/secret/path" }` → `["file_path"]` 만 저장.

---

## 3. OpenClaw 설정

### 3-A. JSONL 파일 감시 (자동)

OpenClaw는 `~/.openclaw/agents/` 하위에 세션을 자동으로 기록합니다.
서버의 `OPENCLAW_WATCH_PATHS` 환경변수가 이 경로를 가리키면 자동 수집됩니다.

```
~/.openclaw/agents/
└── <agentId>/
    └── sessions/
        ├── <sessionId>.jsonl   ← 세션 파일 (자동 감시)
        └── <sessionId>.jsonl
```

**수집 가능한 데이터**:
- 세션 시작/종료
- LLM 모델 ID (각 assistant 응답에 포함)
- 도구 호출/완료/오류
- 토큰 사용량 (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`)
- 사용자 입력
- 어시스턴트 응답 텍스트 길이

OpenClaw는 Claude Code와 달리 **JSONL에 모델 ID와 토큰 사용량이 포함**되므로 HTTP Hooks 없이도 풍부한 데이터를 수집할 수 있습니다.

### 3-B. 세션 종료 감지

OpenClaw는 세션 종료 이벤트를 JSONL에 명시적으로 기록하지 않습니다.
Agent Observatory는 JSONL **파일 삭제** 시 자동으로 `session.end` 이벤트를 발행합니다.

---

## 4. 수집 데이터 요약

### 수집되는 이벤트 타입

```
session.start    — 세션 시작 (모델 정보 포함)
session.end      — 세션 종료
user.input       — 사용자 메시지
tool.start       — 도구 호출 시작 (tool_name, tool_category, input_keys)
tool.end         — 도구 완료 (duration_ms, response_length)
tool.error       — 도구 오류 (error, is_interrupt)
llm.end          — LLM 응답 완료 (text_length, model_id)
metrics.usage    — 토큰 사용량 (input, output, cache tokens, model_id)
subagent.spawn   — 서브에이전트 시작
subagent.end     — 서브에이전트 종료
```

### 소스별 수집 가능 이벤트

| 이벤트 | Claude Code (JSONL) | Claude Code (Hooks) | OpenClaw |
|--------|--------------------|--------------------|----------|
| `session.start` | ✅ | ✅ (model_id 포함) | ✅ (model_id 포함) |
| `session.end` | ✅ | ✅ | ✅ (파일 삭제 시) |
| `user.input` | ✅ | — | ✅ |
| `tool.start` | ✅ | — | ✅ |
| `tool.end` | ✅ | ✅ (response_length) | ✅ (response_length) |
| `tool.error` | — | ✅ (error, is_interrupt) | — |
| `llm.end` | — | — | ✅ (text_length, model_id) |
| `metrics.usage` | — | — | ✅ (full token breakdown) |
| `subagent.spawn` | ✅ (JSONL progress) | ✅ (Hooks) | — |
| `subagent.end` | ✅ (JSONL progress) | ✅ (Hooks) | — |

---

## 5. 동작 확인

### 서버 헬스체크

```bash
curl http://localhost:3000/api/v1/agents
# → [] 또는 현재 활성 에이전트 목록
```

### Hook 수동 테스트

```bash
# SessionStart 테스트
curl -X POST http://localhost:3000/api/v1/hooks/claude-code \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SessionStart",
    "session_id": "test-session-abc123",
    "model": "claude-sonnet-4-6",
    "agent_type": "claude_code"
  }'
# → {"status":"accepted","session_id":"test-session-abc123"}
```

### 서버 로그에서 확인

```
[server] Claude Code collector started (paths: ~/.claude/projects)
[server] OpenClaw collector started (paths: ~/.openclaw/agents)
[hooks] SessionStart: agent=cc-test-ses session=test-session-abc123 model=claude-sonnet-4-6
```

---

## 6. 원격 서버 사용

Agent Observatory를 원격 서버에서 실행하는 경우 URL을 변경합니다.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "https://observatory.example.com/api/v1/hooks/claude-code"
          }
        ]
      }
    ]
  }
}
```

> **주의**: 원격 서버에서 `OPENCLAW_WATCH_PATHS`와 `CLAUDE_CODE_WATCH_PATHS` 파일 감시는 서버 머신의 경로를 기준으로 합니다. 로컬 에이전트 → 원격 서버 구성에서는 HTTP Hooks만 사용하거나, 별도 수집 에이전트를 로컬에서 실행하여 원격 서버로 포워딩해야 합니다.

---

## 7. 트러블슈팅

### 이벤트가 수집되지 않는 경우

1. **서버가 실행 중인지 확인**
   ```bash
   curl http://localhost:3000/api/v1/agents
   ```

2. **JSONL 파일 경로 확인**
   ```bash
   ls ~/.claude/projects/
   ls ~/.openclaw/agents/
   ```

3. **`OBSERVATORY_TAIL_ONLY=false`로 기존 파일 다시 읽기**
   ```bash
   OBSERVATORY_TAIL_ONLY=false pnpm --filter @agent-observatory/server start
   ```

4. **훅 URL이 올바른지 확인** — Claude Code는 훅 오류를 조용히 무시합니다.
   수동으로 `curl`로 테스트해서 200 응답이 오는지 확인합니다.

### `model_id`가 대시보드에 보이지 않는 경우

- JSONL 감시만 사용하는 경우 Claude Code JSONL에는 모델 정보가 없습니다.
- `SessionStart` 훅을 추가하면 모델 ID를 수집할 수 있습니다.
- OpenClaw는 JSONL에 모델 정보가 포함되어 자동 수집됩니다.

### 토큰 사용량이 표시되지 않는 경우

- Claude Code는 JSONL에 토큰 정보를 기록하지 않으며, 현재 Hooks도 토큰 정보를 제공하지 않습니다.
- OpenClaw를 사용하는 경우 자동으로 `metrics.usage` 이벤트가 수집됩니다.
