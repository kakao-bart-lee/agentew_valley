# 에이전트/세션 로그(Transcript/Logs/Telemetry) 조사 — Claude Code vs OpenClaw (2026-02-27)

작성 목적:
- (1) **에이전트/세션의 “로그를 남기는 방식”**을 비교/조사하고,
- (2) 서로 다른 런타임(Claude Code, OpenClaw, 기타 프레임워크)의 로그가 **호환/변환 가능한지** 연구하기 위한 베이스라인 문서.

범위/전제:
- 소스코드 수정/구현은 하지 않고 “관찰/연구” 중심.
- “로그”는 3종으로 구분해 다룹니다: Transcript(대화/툴), Operational Logs(진단 로그), Telemetry(Trace/Metric).
- 본 문서는 **Pixel Agents(`/Users/joy/workspace/pixel-agents`)가 Claude Code JSONL을 파싱하는 방식**도 함께 참고하여, “호환(=시각화 가능한 수준)”을 현실적으로 정의합니다.

---

## 0) 용어 정리: 무엇을 “로그”라고 부를지

### A. Transcript(세션 기록)
대화/툴 호출/툴 결과를 재현 가능한 형태로 남기는 기록.
- 장점: UI 리플레이/세션 재개, 감사/추적, 회고 분석에 유리
- 단점: 민감정보(코드/토큰) 유출 위험이 크고, 스키마가 불안정하면 파서가 깨지기 쉬움

### B. Operational logs(운영 로그)
프로세스 진단/에러/경고/서브시스템 상태 같은 “프로그램 로그”.
- 장점: 운영/디버깅에 필수
- 단점: 세션 단위의 의미 있는 액티비티 트레이싱에는 한계가 있음(구조화가 필요)

### C. Telemetry(관측/계측: Trace/Metrics/OTel)
분산 트레이싱/메트릭으로 각 스텝(툴/모델 호출)을 “Span”처럼 추적하는 방식.
- 장점: 프레임워크/언어/시각화 툴을 넘나드는 공통 기반(OTel)
- 단점: 원본 transcript 복원은 어려울 수 있고(샘플링/집계), 표준 속성(semantic conventions)이 필요

---

## 1) Claude Code: “세션(Transcript)” 로그 방식

### 1.1 저장 위치(로컬 파일)
Claude Code는 세션 transcript를 **JSONL 파일**로 저장하며, 훅/상태라인 입력에서 `transcript_path`가 제공됩니다.
- 예시(공식 문서): `.../.claude/projects/.../<uuid>.jsonl`

참고(공식):
- Hooks 문서에서 `transcript_path` 예시가 `.claude/projects/.../*.jsonl` 형태로 등장합니다.
- Status line 문서에서도 `transcript_path`가 stdin JSON으로 전달됩니다.

### 1.2 JSONL 레코드 타입(관찰된/문서화된 범위)
세션 파일은 단일 스키마 “1종”이 아니라 여러 `type`이 섞입니다.
- `user`, `assistant`, `system`, `summary`, 기타 내부 타입(`file-history-snapshot`, `queue-operation` 등)
- tool_use / tool_result는 `assistant.message.content` 블록 또는 `user.message.content` 블록에 섞여 나타납니다(관찰 기반)

주의:
- Claude Code의 **CLI 출력 포맷(stream-json)** 스키마와, **디스크에 저장되는 transcript 파일 스키마**는 유사하지만 완전히 동일하다고 가정하면 위험합니다.
  - SDK/CLI 출력은 “출력 스키마가 문서화”되어 있지만, 디스크 transcript는 내부 이벤트가 더 섞여 들어갈 수 있습니다.

### 1.3 Pixel Agents가 기대하는 Claude Code JSONL “최소 부분집합”
Pixel Agents는 Claude Code transcript JSONL을 **완전 해석**하려고 하기보다는, “지금 에이전트가 무슨 툴을 쓰는지/대기중인지”를 만들기 위한 **일부 레코드 타입**만 봅니다.

핵심 구현 근거:
- `/Users/joy/workspace/pixel-agents/src/transcriptParser.ts`

Pixel Agents가 직접 처리하는(=시각화에 핵심인) 레코드:

1) **툴 시작**: `type: "assistant"` + `message.content[]` 내부 `tool_use`
2) **툴 종료**: `type: "user"` + `message.content[]` 내부 `tool_result`
3) **턴 종료(대기 전환)**: `type: "system"`, `subtype: "turn_duration"`
4) (선택) **진행 이벤트**: `type: "progress"` (특히 `bash_progress`, `mcp_progress`, `agent_progress`)

즉 “호환 가능”을 Pixel Agents 관점에서 정의하면:
- 원본 transcript가 Claude Code가 아니어도, 위 1~3(+4)를 **Claude Code 유사 JSONL**로 생성할 수 있으면, Pixel Agents에서 “툴 사용/대기 상태”는 재현 가능합니다.

#### 최소 예시(JSONL 샘플; Pixel Agents 파서 기준의 형태)
아래는 “정확한 공식 스키마”가 아니라, Pixel Agents가 읽는 필드만 포함한 **실용 최소형**입니다.

툴 시작:
```json
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/abs/path/file.ts"}}]}}
```

툴 종료:
```json
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":[{"type":"text","text":"(tool output omitted)"}]}]}}
```

턴 종료(대기 전환):
```json
{"type":"system","subtype":"turn_duration","duration_ms":1234}
```

서브에이전트/Task 진행(선택):
```json
{"type":"progress","parentToolUseID":"toolu_task","data":{"type":"agent_progress","message":{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_sub_1","name":"Grep","input":{"pattern":"TODO"}}]}}}}
```

> Pixel Agents는 tool id를 기준으로 active tool set을 관리하므로(`activeToolIds`), **id/연결 관계(tool_use_id)**가 최소한 일관되게 유지되어야 합니다.

### 1.4 “로그를 더 남기는/후킹하는” 방식
Claude Code는 hooks/statusline처럼 “세션 이벤트 + transcript_path”를 외부 스크립트에 전달하므로,
추가 계측/필터링/외부로 export하는 통로가 됩니다.
- 예: PreToolUse/PostToolUse에서 툴 입력/출력을 스크립트로 받아 별도 저장
- 예: statusline 입력에서 비용/작업시간/라인 변경 등 메타를 받아 지속 저장

---

## 2) OpenClaw: “세션(Transcript) + 운영로그 + 텔레메트리” 3층 구조

OpenClaw는 **Gateway 중심**으로 세션을 관리하며, 로컬 디스크에 세션 transcript(JSONL)와 세션 스토어(sessions.json)를 둡니다.

### 2.1 Session store vs Transcript
OpenClaw는 2개의 저장 레이어가 있습니다.

1) **세션 스토어**: `sessions.json`
- 경로(기본): `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- 키: `sessionKey` → 값: `{ sessionId, updatedAt, ... }`
- UI/CLI에서 세션 목록/메타를 보기 위한 인덱스 성격

2) **세션 transcript**: `<sessionId>.jsonl`
- 경로(기본): `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`
- append-only JSONL (트리 구조를 유지하기 위해 `id`, `parentId`가 쓰이는 형태)
- 대화 메시지/툴 결과/컴팩션 요약 등 실제 세션 기록

### 2.2 운영 로그(Operational logs)
Gateway는 별도의 **파일 로그(JSONL)**를 남기고, CLI/웹 UI에서 tail 할 수 있습니다.
- 기본 rolling 로그 파일: `/tmp/openclaw/openclaw-YYYY-MM-DD.log`
- `openclaw logs --follow`로 RPC 통해 tail(원격에서도 SSH 없이)

### 2.3 Telemetry(OpenTelemetry)
OpenClaw는 diagnostics를 통해 **OTel(OTLP/HTTP)** exporter로 trace/metrics/logs를 내보낼 수 있습니다.
즉, “다른 프레임워크 로그를 모아 대시보드화”하려면 OpenClaw 쪽은 이미 OTel 지향으로 갈 수 있는 발판이 있습니다.

### 2.4 OpenClaw transcript JSONL 구조(실제 파일 형태)
구현/테스트 근거:
- 세션 헤더 생성: `/Users/joy/workspace/openclaw/src/config/sessions/transcript.ts`의 `ensureSessionHeader()`
- 세션 deep dive 문서: `/Users/joy/workspace/openclaw/docs/reference/session-management-compaction.md`의 “Transcript structure”
- 테스트 예시: `/Users/joy/workspace/openclaw/src/auto-reply/reply/session.test.ts`

#### 2.4.1 첫 줄: session header
```json
{"type":"session","version":7,"id":"<sessionId>","timestamp":"2026-02-27T00:00:00.000Z","cwd":"/path"}
```

#### 2.4.2 이후: tree 구조 entry(id/parentId)를 가진 entry들
가장 흔한 엔트리 예시(`type:"message"`):
```json
{"type":"message","id":"m1","parentId":null,"timestamp":"2026-02-27T00:00:00.000Z","message":{"role":"user","content":"Hello"}}
```

문서상 “Notable entry types”(요약):
- `message`: user/assistant/toolResult 메시지
- `custom_message`: 모델 컨텍스트에는 들어가지만(UI에서 숨길 수 있는) 확장 메시지
- `custom`: 확장 상태 등(모델 컨텍스트에 들어가지 않는) 상태 저장
- `compaction`: compaction 요약(영속)
- `branch_summary`: 트리 브랜치 요약(영속)

#### 2.4.3 툴 호출/툴 결과 표현(추정: pi-agent-core 메시지 포맷 계열)
OpenClaw는 내부적으로 `@mariozechner/pi-agent-core`의 `AgentMessage`를 사용하며, 아래처럼 툴 호출/결과를 다룹니다.
- 툴 호출: assistant 메시지의 content 블록 중 `type: "toolCall" | "toolUse" | "functionCall"`
- 툴 결과: `role: "toolResult"` 메시지에 `toolCallId`/`toolUseId`가 붙을 수 있음

근거:
- `/Users/joy/workspace/openclaw/src/agents/tool-call-id.ts`의 `extractToolCallsFromAssistant()` / `extractToolResultId()`

> 결론: OpenClaw transcript는 “Claude Code JSONL과는 다른 스키마”지만, **tool call id와 결과 id를 연결하는 구조가 존재**하므로, 이벤트 단위로 재매핑(=호환) 가능성이 큽니다.

---

## 3) Claude Code ↔ OpenClaw 호환(가능성) 분석

### 3.1 공통점(호환에 유리)
- 둘 다 “세션 기록”의 기본 단위가 **JSONL**입니다.
- 둘 다 “세션 식별자(session_id/sessionId)” 개념이 존재합니다.
- 둘 다 “툴 호출/툴 결과”가 transcript에 남습니다(표현은 다름).

### 3.2 차이점(그냥 붙이면 깨지는 지점)
- **저장 경로/폴더 규약**이 다름 (`~/.claude/projects/...` vs `~/.openclaw/agents/.../sessions/...`)
- **레코드 스키마가 다름**
  - Claude Code: `type=user|assistant|system|progress|...` + `message.content`에 블록
  - OpenClaw: `type=session` 헤더 + 이후 `type=message|custom|compaction|...` + 트리 구조(`id`, `parentId`)
- “서브에이전트/멀티에이전트” 표현도 다름(Claude Code는 팀/서브에이전트가 별도 transcript로 나뉠 수 있고, OpenClaw는 sessionKey/sessionId 체계로 다룸)

### 3.3 Pixel Agents(현 리포) 관점의 호환성
Pixel Agents는 현재 Claude Code의 transcript(JSONL)를 파싱하는 전제입니다.
- 따라서 OpenClaw transcript를 그대로 Pixel Agents에 물리려면:
  1) Pixel Agents에 OpenClaw transcript 파서를 추가하거나(코드 변경 필요),
  2) OpenClaw transcript를 Claude Code transcript 형태로 **변환해서** Pixel Agents가 기대하는 위치에 생성(“외부 변환기/브릿지” 방식)

브릿지(변환기) 방식은 “본체 소스 수정 없이” 실험하기가 쉬운 편입니다.

### 3.4 “호환”을 어떤 레벨로 정의할지(권장)
호환을 3레벨로 나누면 의사결정이 쉬워집니다.

| 레벨 | 목표 | 필요한 데이터 | 대표 UI |
|---|---|---|---|
| L1. Status/Tool 수준 | “지금 뭐함?” | tool start/end, waiting, error | Pixel Agents 같은 픽셀 뷰, 간단 대시보드 |
| L2. Timeline 수준 | “언제 뭐했나?” | timestamped events + 관계(parent/child) | 타임라인/간트 |
| L3. Full replay 수준 | “대화/툴 결과까지 재생” | transcript 원문 + 안정 스키마 + 민감정보 처리 | 세션 리플레이어/감사 |

Pixel Agents는 본질적으로 L1~L2에 가깝습니다(대화 내용 전체를 UI에 표시하지 않음).

### 3.5 변환(브릿지) 접근법 비교
| 접근 | 장점 | 단점 | “본체 코드 수정 없이” 실험 |
|---|---|---|---|
| A) **Claude Code 유사 JSONL 생성**(Pixel Agents 입력에 맞춤) | Pixel Agents 재사용, 빠른 PoC | 스키마 추정/유지보수, 터미널/세션 채택 제약 | 쉬움 |
| B) **통합 이벤트 포맷(UAEP 등)으로 정규화** 후 웹 대시보드 | 소스 다변화에 강함, 장기 확장 | 새 UI/서버 필요 | 중간 |
| C) **OTel(OpenInference)로 계측/수집** | 표준 생태계(collector, storage, UI) 활용 | transcript 복원은 별도, 속성 설계 필요 | 중간 |

권장 로드맵:
1) L1 목표로 A를 먼저 해보고(가시화가 빨리 됨),
2) 곧바로 B/C 중 하나를 “장기 표준”으로 선택해 확장(스웜/팀 대시보드까지 커버).

---

## 4) 권장 연구 방향(다음 단계)

### 4.1 “표준 포맷”을 무엇으로 둘지 결정
선택지 A) **OpenTelemetry + OpenInference(semantic conventions)**
- 장점: 도구 생태계(Phoenix/Langfuse/Grafana/Jaeger 등)에 바로 얹기 쉬움
- 단점: 원본 transcript 복원/리플레이까지는 별도 설계 필요

선택지 B) **커스텀 JSONL event schema(Agent Activity Events v1)**
- 장점: Pixel viewer 같은 특화 UI에 맞춘 최소 이벤트를 정의하기 쉬움
- 단점: 재발명 위험, 외부 툴 연동은 추가 작업 필요

### 4.2 최소 이벤트 세트 정의(“호환성”의 기준점)
다음 이벤트만 공통으로 정의해도 대부분의 시각화가 가능합니다.
- Session: start/end, metadata(model, cwd, repo, user, channel 등)
- Turn: start/end
- Tool: start/end/progress, tool_name, input summary, result summary, error
- Agent: status(active/waiting/needs_approval)
- Subagent/Team: parent-child 관계(또는 span parent-child)

### 4.3 “스웜/팀”을 위한 추가 필드(권장)
다중 에이전트 로그를 한 화면에 모으려면, 최소한 아래 식별자를 통일해야 합니다.
- `agent_id`: 에이전트 고유 ID(프로세스/워크플로 단위)
- `session_id` 또는 `trace_id`: “한 번의 실행”을 묶는 상위 ID
- `parent_agent_id` 또는 `parent_span_id`: 서브에이전트 관계
- `agent_group` 또는 `team_id`: 스웜/팀 묶음
- `source`: claude_code / openclaw / agent_sdk / custom 등

---

## 5) 참고 링크(후속 조사 대상)

Claude Code(공식)
- Hooks / Statusline / Claude Code SDK 문서(Anthropic docs)

OpenClaw(로컬 리포 기준)
- `docs/concepts/session.md`, `docs/reference/session-management-compaction.md`, `docs/logging.md`, `docs/web/control-ui.md`

오픈 표준/계측
- OpenTelemetry, OpenInference(OpenTelemetry semantic conventions for LLM)
