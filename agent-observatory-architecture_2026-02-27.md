# Agent Observatory - 아키텍처 설계서 (v0.2)

> 에이전트 활동을 실시간으로 관찰하고 비주얼하게 시각화하는 독립 웹서비스

**작성일**: 2026-02-27
**버전**: v0.2 (연구 반영 보강)
**관련 연구**: 01_agent_session_logging, 02_visualization_abstraction, 03_swarm_team_dashboard_cases
**관련 문서**: `FE-dashboard-spec_2026-02-27.md` (대시보드 FE 계획서 — 별도 팀 전달용)

---

## 1. 프로젝트 개요

### 1.1 목표

다양한 종류의 AI 에이전트(Claude Code CLI, Agent SDK 스웜, OpenClaw, 기타 프레임워크)의 활동을 하나의 웹서비스에서 실시간으로 관찰하되, 단순 대시보드를 넘어 pixel-agents 스타일의 비주얼 시각화까지 제공한다.

### 1.2 핵심 요구사항

- **독립 웹서비스**: VS Code 종속 없이 브라우저에서 접근
- **다중 에이전트 소스**: Claude Code JSONL, OpenClaw sessions/OTel, Agent SDK hooks, 커스텀 에이전트
- **실시간 관찰**: 에이전트 상태 변화를 즉시 반영
- **진화하는 시각화**: 대시보드 → 픽셀 캐릭터 → 타임라인 → 확장 가능한 구조
- **팀 분리 가능**: 대시보드 FE는 별도 에이전트 팀에 위임할 수 있는 독립적 구조

### 1.3 pixel-agents에서 배운 것

- **관찰(Observational) 패턴**: 에이전트 코드를 수정하지 않고, 남기는 로그/이벤트만 읽어서 시각화
- **1:1:1 매핑**: Terminal → Session → Agent(캐릭터) 연결이 직관적
- **Canvas 2D로 충분**: 픽셀아트 + 게임루프로 생동감 있는 시각화 가능
- **Pixel Agents 최소 파싱 대상**: `tool_use`(시작), `tool_result`(종료), `turn_duration`(대기 전환), `progress`(서브에이전트) — 이 4가지만으로 L1 시각화 가능
- **한계**: VS Code webview 종속, Claude Code JSONL 포맷에 강결합

### 1.4 유사 사례에서 배운 것

| 카테고리 | 도구/서비스 | 핵심 패턴 |
|---|---|---|
| 프레임워크 Studio | LangGraph Studio, AutoGen Studio, CrewAI Studio | 실행 단위 = graph run/crew run, 노드/스텝별 이벤트 UI 매핑 |
| 관측/추적 | Langfuse, LangSmith, Arize Phoenix | trace → span 계층, 비용/토큰/latency 집계, 검색/필터 |
| OTel 표준 | OpenInference, OpenLLMetry | LLM semantic conventions, 프레임워크 중립 계측 |
| Transcript 뷰어 | claude-code-log, claude-code-viewer | Claude Code JSONL 특화 파싱, 브라우저 렌더링 |

**공통 수렴 모델**: Session/Trace → Agent → Tool Call(Span) → Subagent(Child Span)

---

## 2. 호환성 레벨 모델 (연구 반영)

시각화 목표와 필요 데이터를 3레벨로 명확히 정의한다.

```
┌──────┬──────────────────┬──────────────────────────────────┬──────────────────────┐
│ 레벨 │ 질문             │ 필요 데이터                       │ 대표 UI              │
├──────┼──────────────────┼──────────────────────────────────┼──────────────────────┤
│ L1   │ "지금 뭐함?"     │ tool start/end, agent status,    │ 픽셀 캐릭터,         │
│      │                  │ waiting, error                   │ 상태 대시보드        │
├──────┼──────────────────┼──────────────────────────────────┼──────────────────────┤
│ L2   │ "언제 뭐했나?"   │ timestamped events +             │ 타임라인/간트,       │
│      │                  │ parent/child 관계                │ 비용 분석            │
├──────┼──────────────────┼──────────────────────────────────┼──────────────────────┤
│ L3   │ "무엇을 했나?"   │ transcript 원문 +                │ 세션 리플레이어,     │
│      │ (내용)           │ 안정 스키마 + 민감정보 처리       │ 감사/디버깅          │
└──────┴──────────────────┴──────────────────────────────────┴──────────────────────┘

Phase 1 → L1 (대시보드 + 픽셀 뷰의 기본)
Phase 2 → L2 (타임라인 + 관계 그래프)
Phase 3 → L3 (세션 재생 + 감사)
```

---

## 3. 데이터 소스별 로그 구조 비교

### 3.1 Claude Code JSONL

```
위치:    ~/.claude/projects/<project-hash>/<uuid>.jsonl
형태:    append-only JSONL
핵심 레코드:
  type: "user"       → message.content[] (사용자 입력, tool_result 블록 포함)
  type: "assistant"  → message.content[] (AI 응답, tool_use 블록 포함)
  type: "system"     → subtype: "turn_duration" (턴 종료/대기 전환)
  type: "progress"   → data.type: "agent_progress" (서브에이전트 진행)
  기타: "summary", "file-history-snapshot", "queue-operation"

Pixel Agents 파서가 필요한 최소 필드:
  tool_use:    { type, id, name, input }
  tool_result: { type, tool_use_id, content }
  turn_duration: { type, subtype, duration_ms }

주의사항:
  - CLI 출력(stream-json)과 디스크 transcript 스키마는 유사하지만 동일하지 않음
  - 내부 전용 레코드가 섞여있어 "알려진 타입만 처리"하는 방어적 파싱 필요
```

### 3.2 OpenClaw (신규 소스 추가)

```
위치:    ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
인덱스:  ~/.openclaw/agents/<agentId>/sessions/sessions.json
형태:    append-only JSONL (트리 구조: id/parentId)

핵심 레코드:
  첫 줄 헤더: { type: "session", version: 7, id, timestamp, cwd }
  이후:
    type: "message"        → { id, parentId, message: { role, content } }
    type: "custom_message"  → 확장 메시지 (모델 컨텍스트 포함)
    type: "custom"          → 확장 상태 (모델 컨텍스트 미포함)
    type: "compaction"      → 세션 요약/압축
    type: "branch_summary"  → 브랜치 요약

툴 호출 표현:
  - assistant content에서 type: "toolCall"/"toolUse"/"functionCall"
  - role: "toolResult" 메시지에 toolCallId/toolUseId

추가 데이터:
  - 운영 로그: /tmp/openclaw/openclaw-YYYY-MM-DD.log (rolling JSONL)
  - OTel export: diagnostics → OTLP/HTTP exporter 지원 (trace/metrics/logs)
```

### 3.3 Agent SDK Hooks

```
형태:    런타임 hook 콜백 (UserPromptSubmit, PreToolUse, PostToolUse 등)
수집법:  hook에서 HTTP POST / JSONL 파일 기록

추가 채널:
  - statusline 입력: transcript_path + 비용/작업시간/라인변경 메타
  - hooks 입력: transcript_path + session_id + 도구 정보
```

### 3.4 소스 간 차이 요약

```
┌─────────────┬─────────────────────┬──────────────────────┬──────────────────────┐
│             │ Claude Code          │ OpenClaw              │ Agent SDK            │
├─────────────┼─────────────────────┼──────────────────────┼──────────────────────┤
│ 저장 형태   │ JSONL (flat)         │ JSONL (tree id/parent)│ hook 콜백 (무저장)   │
│ 세션 식별   │ 파일명 UUID          │ sessionId + store     │ session_id (런타임)  │
│ 툴 호출 표현│ tool_use 블록        │ toolCall/toolUse 블록 │ PreToolUse hook      │
│ 툴 결과 표현│ tool_result 블록     │ toolResult 메시지     │ PostToolUse hook     │
│ 서브에이전트│ 별도 transcript 파일 │ sessionKey/Id 체계    │ parent context       │
│ OTel 지원   │ 없음 (hooks 우회)    │ diagnostics exporter  │ 없음 (커스텀 필요)   │
│ L1 변환     │ 쉬움                 │ 중간                  │ 쉬움                 │
└─────────────┴─────────────────────┴──────────────────────┴──────────────────────┘
```

---

## 4. 시스템 아키텍처 (전체 개요)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     DATA SOURCES (에이전트들)                        │
│                                                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐      │
│  │ Claude Code│ │  OpenClaw  │ │ Agent SDK  │ │  Custom    │      │
│  │ CLI (JSONL)│ │ (JSONL+OTel)│ │  Swarm    │ │  Agents   │      │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘      │
└────────┼───────────────┼──────────────┼──────────────┼──────────────┘
         │               │              │              │
         ▼               ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COLLECTION LAYER (수집 계층)                      │
│                                                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐      │
│  │ CC JSONL   │ │ OC JSONL   │ │ SDK Hook   │ │ HTTP/WS    │      │
│  │ Watcher    │ │ Watcher    │ │ Collector  │ │ Collector  │      │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘      │
│        │               │              │              │              │
│        └───────────────┴──────┬───────┴──────────────┘              │
│                               ▼                                     │
│                 ┌──────────────────────┐                            │
│                 │   Event Normalizer   │  ← 소스별 → UAEP 변환     │
│                 │   (소스별 Normalizer) │                            │
│                 └──────────┬───────────┘                            │
└────────────────────────────┼────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PROCESSING LAYER (처리 계층)                      │
│                                                                     │
│  ┌──────────────────────────────────────────────┐                  │
│  │   Event Bus (EventEmitter → Redis Streams)   │                  │
│  └──────────────────────┬───────────────────────┘                  │
│                         │                                           │
│            ┌────────────┼────────────┐                              │
│            ▼            ▼            ▼                              │
│  ┌─────────────┐ ┌───────────┐ ┌──────────┐                       │
│  │ State       │ │ Metrics   │ │ History  │                        │
│  │ Manager     │ │ Aggregator│ │ Store    │                        │
│  │ (Live)      │ │ (Window)  │ │ (Persist)│                        │
│  └──────┬──────┘ └─────┬─────┘ └────┬─────┘                       │
│         │              │             │                              │
│  ┌──────┴──────────────┴─────────────┘                              │
│  │  (선택) OTel Exporter → 외부 Jaeger/Grafana/Langfuse            │
│  └──────────────────────────────────────────────────────────────────│
└─────────┬──────────────┬─────────────┬──────────────────────────────┘
          │              │             │
          ▼              ▼             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  DELIVERY LAYER (전달 계층)                          │
│                                                                     │
│  ┌─────────────────────────────────┐  ┌──────────────────────┐     │
│  │   WebSocket Server (Socket.IO)  │  │  REST API (조회/설정) │     │
│  └──────────────────┬──────────────┘  └──────────┬───────────┘     │
│                     │                             │                  │
│  채널:              │                             │                  │
│  /live              │  /dashboard  /pixel         │                  │
│  /live/{agent_id}   │                             │                  │
└─────────────────────┼─────────────────────────────┼─────────────────┘
                      │                             │
                      ▼                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PRESENTATION LAYER (표현 계층)                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────┐               │
│  │              Web Application (React)            │               │
│  │                                                 │               │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────┐│               │
│  │  │  Dashboard   │  │ Pixel Office  │  │ Time-││               │
│  │  │  View        │  │ View          │  │ line ││               │
│  │  │ ※별도 FE 문서│  │ (Canvas 2D)   │  │ View ││               │
│  │  └──────────────┘  └───────────────┘  └──────┘│               │
│  └─────────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Universal Agent Event Protocol (UAEP)

### 5.1 설계 원칙

- **OpenTelemetry Span 모델 기반**: trace_id → span_id 계층 구조
- **L1~L2 최적화 우선 (UAEP-min)**: 픽셀 뷰 + 대시보드에 필요한 최소 이벤트 세트
- **확장 가능**: `metadata` 필드로 소스별 고유 데이터 보존
- **OTel 브릿지 가능**: 추후 OTel(OpenInference) exporter로 외부 관측 도구 연결

### 5.2 UAEP-min (경량 버전 — Phase 1 표준)

L1~L2에 필요한 최소 이벤트만 정의. 처음부터 무거운 Full UAEP를 구현하지 않고 이것으로 시작.

```typescript
// UAEP-min: 모든 이벤트의 기본 Envelope
interface UAEPEvent {
  // === 시간/순서 ===
  ts: string;                    // ISO-8601
  seq?: number;                  // 소스별 증가 시퀀스 (선택)

  // === 식별자 ===
  event_id: string;              // UUID v7 (시간 순서 보장)
  source: AgentSourceType;       // 원본 소스 종류
  agent_id: string;              // 에이전트 고유 ID
  agent_name?: string;           // 표시 이름
  session_id: string;            // 세션/trace 단위
  span_id?: string;              // 작업 단위 (tool/llm call)
  parent_span_id?: string;       // 부모 span (서브에이전트 연결)
  team_id?: string;              // 스웜/팀 묶음

  // === 이벤트 종류 ===
  type: UAEPEventType;

  // === 페이로드 ===
  data?: Record<string, unknown>;

  // === 원본 보존 ===
  metadata?: Record<string, unknown>;
}

type AgentSourceType =
  | 'claude_code'
  | 'openclaw'
  | 'agent_sdk'
  | 'langchain'
  | 'crewai'
  | 'custom';

type UAEPEventType =
  | 'session.start'
  | 'session.end'
  | 'agent.status'
  | 'tool.start'
  | 'tool.end'
  | 'tool.error'
  | 'llm.start'
  | 'llm.end'
  | 'user.input'
  | 'user.permission'
  | 'subagent.spawn'
  | 'subagent.end'
  | 'metrics.usage';
```

### 5.3 도구 카테고리 매핑 (시각화 힌트)

픽셀 애니메이션은 "도구 이름"이 아닌 "행동 카테고리"로 구동. 대시보드에서도 카테고리별 분포를 표시.

```typescript
type ToolCategory =
  | 'file_read'        // Read, Glob, Grep → 모니터 응시
  | 'file_write'       // Write, Edit, NotebookEdit → 타이핑
  | 'command'          // Bash, Exec → 터미널 조작
  | 'search'           // WebSearch → 돋보기
  | 'web'              // WebFetch, Browser → 브라우저
  | 'planning'         // EnterPlanMode, Plan → 칠판/화이트보드
  | 'thinking'         // LLM reasoning 구간 → 전구/말풍선
  | 'communication'    // AskUserQuestion, SendMessage → 대화
  | 'other';

// 도구 이름 → 카테고리 매핑 테이블
const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  'Read': 'file_read', 'Glob': 'file_read', 'Grep': 'file_read',
  'Write': 'file_write', 'Edit': 'file_write', 'NotebookEdit': 'file_write',
  'Bash': 'command',
  'WebSearch': 'search',
  'WebFetch': 'web',
  'EnterPlanMode': 'planning', 'ExitPlanMode': 'planning',
  'AskUserQuestion': 'communication',
  'Task': 'communication',  // 서브에이전트 생성
};
```

### 5.4 소스별 → UAEP 변환 매핑 (확장)

```
┌─────────────────────────────┬──────────────────────────┬──────────────────────────┐
│ UAEP Event                  │ Claude Code JSONL        │ OpenClaw JSONL           │
├─────────────────────────────┼──────────────────────────┼──────────────────────────┤
│ session.start               │ 파일 생성 감지           │ type:"session" 헤더 줄    │
│ session.end                 │ 파일 삭제/더 이상 append X│ session store 갱신 안 됨  │
│ agent.status → thinking     │ type:"assistant" 시작    │ role:"assistant" 메시지   │
│ agent.status → idle         │ type:"system" turn_dur.  │ 다음 user 메시지          │
│ agent.status → waiting      │ permission 요청          │ (해당 시 custom 레코드)    │
│ tool.start                  │ tool_use 블록            │ toolCall/toolUse 블록     │
│ tool.end                    │ tool_result 블록         │ role:"toolResult" 메시지  │
│ user.input                  │ type:"user" 메시지       │ role:"user" 메시지        │
│ subagent.spawn              │ progress.agent_progress  │ (하위 세션 생성)          │
│ metrics.usage               │ usage 필드 / statusline  │ diagnostics OTel metric  │
└─────────────────────────────┴──────────────────────────┴──────────────────────────┘
```

### 5.5 Full UAEP (Phase 2+ 확장)

UAEP-min에서 확장 시 추가되는 필드:

```typescript
// Full UAEP에서 추가 (UAEP-min은 data? 필드로 느슨하게 수용)
interface AgentEvent extends UAEPEvent {
  agent_type: AgentSourceType;   // → source와 분리 (SDK로 Claude를 쓰는 경우)
  agent_group?: string;          // 에이전트 그룹명
  data: EventData;               // 타입별 강타입
}

// 타입별 강타입 data
interface ToolStartData {
  tool_name: string;
  tool_category: ToolCategory;
  tool_input_summary?: string;
}

interface ToolEndData {
  tool_name: string;
  tool_category: ToolCategory;
  duration_ms: number;
  success: boolean;
  output_summary?: string;
}

interface MetricsUsageData {
  model?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
}

interface SubagentSpawnData {
  child_agent_id: string;
  child_agent_name: string;
  task_description?: string;
}
```

---

## 6. Collection Layer (수집 계층) 상세

### 6.1 Collector 인터페이스

```typescript
interface Collector {
  name: string;
  sourceType: AgentSourceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: UAEPEvent) => void): void;
}
```

### 6.2 Claude Code JSONL Collector

```
감시 대상:  ~/.claude/projects/**/*.jsonl
동작:
  1. chokidar로 디렉토리 재귀 감시
  2. 새 .jsonl 파일 → session.start 이벤트 생성
  3. 파일 append → tail 방식으로 새 줄만 파싱 → UAEP 변환
  4. 파일 미변경 timeout → agent.status: idle
  5. 파일 삭제/이동 → session.end

핵심 설계:
  - 오프셋 관리: 파일별 마지막 읽은 바이트 위치 저장
  - 방어적 파싱: 알려진 type만 처리, 미지 타입은 metadata에 보존
  - tool_use.id ↔ tool_result.tool_use_id 매칭으로 active tool set 관리
  - progress 레코드의 중첩(서브에이전트 내 tool_use) 재귀 처리
```

### 6.3 OpenClaw JSONL Collector (신규)

```
감시 대상:  ~/.openclaw/agents/*/sessions/*.jsonl
인덱스 참조: sessions.json으로 활성 세션 파악

동작:
  1. sessions.json 변화 감시 → 새 세션 등록/삭제
  2. 세션 JSONL 파일 append → tail 방식 파싱
  3. 트리 구조(id/parentId) 해석해 parent-child 관계 추적
  4. toolCall/toolUse → tool.start, toolResult → tool.end

차이점:
  - 첫 줄이 session 헤더 (version, cwd 등 메타 포함)
  - role:"toolResult" 메시지에 toolCallId가 별도 필드
  - compaction/branch_summary는 무시 가능 (L1/L2에 불필요)

OTel 보완 (선택):
  - OpenClaw의 diagnostics OTel exporter가 활성화된 경우,
    OTLP receiver로 trace/metric도 수신 가능 (L2+에서 유용)
```

### 6.4 Agent SDK Hook Collector

```
Option A: HTTP Webhook (프로덕션/원격)
  - POST /api/v1/hooks/sdk 로 hook 이벤트 수신
  - PreToolUse → tool.start, PostToolUse → tool.end

Option B: 공유 JSONL (로컬 개발)
  - hook에서 Claude Code 호환 JSONL 기록 → CC Collector가 수집

추가 채널:
  - Claude Code hooks의 statusline 입력 → 비용/세션 메타 수집
  - transcript_path → 파일 위치 자동 발견
```

### 6.5 Custom Agent Collector (범용 HTTP)

```
REST API:
  POST /api/v1/events          - 단일 UAEP 이벤트
  POST /api/v1/events/batch    - 배치 전송
  POST /api/v1/sessions        - 세션 등록
  DELETE /api/v1/sessions/:id  - 세션 종료
인증: API Key (X-Api-Key 헤더)
```

---

## 7. Processing Layer (처리 계층) 상세

### 7.1 Event Bus

```
Phase 1: Node.js EventEmitter (단일 프로세스, 0 의존성)
Phase 2: Redis Streams (수평 확장, 영속성, Consumer Group)

스트림 구조 (Redis 전환 시):
  stream:events              - 전체 이벤트
  stream:events:{agent_id}   - 에이전트별 (선택)
  stream:events:{team_id}    - 팀별 (선택)
```

### 7.2 State Manager

```typescript
interface AgentLiveState {
  agent_id: string;
  agent_name: string;
  source: AgentSourceType;
  team_id?: string;

  // 현재 상태
  status: 'idle' | 'thinking' | 'acting' | 'waiting_input' | 'waiting_permission' | 'error';
  current_tool?: string;
  current_tool_category?: ToolCategory;
  status_detail?: string;          // "Reading: src/main.ts"
  last_activity: string;           // ISO timestamp

  // 세션 정보
  session_id: string;
  session_start: string;

  // 누적 메트릭
  total_tokens: number;
  total_cost_usd: number;
  total_tool_calls: number;
  total_errors: number;
  tool_distribution: Record<ToolCategory, number>;

  // 서브에이전트 관계
  parent_agent_id?: string;
  child_agent_ids: string[];

  // 시각화 메타
  pixel_character?: string;
  pixel_position?: { x: number; y: number };
  pixel_seat?: string;
}
```

### 7.3 Metrics Aggregator

```
시계열 (1분 윈도우):
  - tokens_per_minute (에이전트별 + 전체)
  - cost_per_minute
  - tool_calls_per_minute
  - error_rate
  - active_agents_count

집계:
  - 세션별 총 토큰/비용/시간
  - 도구 카테고리별 사용 빈도 & 평균 소요시간
  - 에이전트별 활동 히트맵 (시간대별)

저장 전략:
  Phase 1: 인메모리 (최근 1시간 슬라이딩 윈도우)
  Phase 2: SQLite (히스토리)
  Phase 3: TimescaleDB / InfluxDB (대규모 시계열)
```

### 7.4 History Store

```
Phase 1: 로컬 JSONL
  sessions/{session_id}/events.jsonl
  sessions/{session_id}/summary.json

Phase 2: SQLite (검색/필터)
  events 테이블 + sessions 테이블 + FTS5 인덱스

Phase 3: PostgreSQL (다중 사용자, 대규모)
```

### 7.5 OTel Exporter (Phase 3+)

```
UAEP 이벤트를 OTel Span으로 변환하여 외부 관측 도구로 전송.
  - tool.start/end → OTel Span (tool_name, duration, status)
  - session → OTel Trace
  - metrics.usage → OTel Metric

대상: Jaeger, Grafana Tempo, Langfuse, Arize Phoenix
프로토콜: OTLP/HTTP

이를 통해 기존 관측 생태계와 자연스럽게 연결.
내부는 UAEP가 표준이고, 외부 연동만 OTel exporter를 거침.
```

---

## 8. Delivery Layer (전달 계층) 상세

### 8.1 WebSocket (Socket.IO)

```
채널:
  /live              - 전체 에이전트 실시간 스트림
  /live/{agent_id}   - 특정 에이전트 상세
  /dashboard         - 집계 메트릭 (1초 배치)
  /pixel             - 픽셀 시각화용 (100ms 배치, 상태 delta)

클라이언트 → 서버:
  subscribe(agent_id)    - 특정 에이전트 구독
  unsubscribe(agent_id)  - 구독 해제
  set_view(view_type)    - 대시보드/픽셀/타임라인 전환 → 전달 최적화
  update_layout(data)    - 픽셀 레이아웃 변경
```

### 8.2 REST API

```
GET  /api/v1/agents              - 활성 에이전트 목록 + 상태
GET  /api/v1/agents/:id          - 특정 에이전트 상세
GET  /api/v1/agents/:id/events   - 이벤트 히스토리 (페이지네이션)
GET  /api/v1/sessions            - 세션 목록
GET  /api/v1/sessions/:id        - 세션 상세 + 이벤트
GET  /api/v1/metrics/summary     - 집계 메트릭 스냅샷
GET  /api/v1/metrics/timeseries  - 시계열 메트릭 (쿼리 파라미터)
GET  /api/v1/config              - 설정 조회
PUT  /api/v1/config              - 설정 변경

※ 대시보드 FE 팀은 이 API 스펙을 기준으로 개발 (별도 문서 참조)
```

---

## 9. Presentation Layer (표현 계층) 개요

### 9.1 기술 스택

```
┌──────────────┬─────────────────────────────────────────┐
│ 레이어       │ 기술                                     │
├──────────────┼─────────────────────────────────────────┤
│ Framework    │ React 19 + TypeScript                   │
│ Build        │ Vite                                    │
│ 상태관리     │ Zustand                                 │
│ 실시간       │ Socket.IO Client                        │
│ 렌더링       │ Canvas 2D (픽셀) + DOM (대시보드)        │
│ 스타일링     │ Tailwind CSS                            │
│ 차트         │ Recharts                                │
│ 라우팅       │ React Router                            │
└──────────────┴─────────────────────────────────────────┘
```

### 9.2 뷰 모드

```
3가지 뷰 모드 + 공통 셸:

[App Shell] ─── [Dashboard View]     ← 별도 FE 계획서 참고
           ├── [Pixel Office View]  ← 본 문서 부록 A 참고
           └── [Timeline View]      ← Phase 2+ (본 문서 §10.2)
```

**대시보드 뷰**는 `FE-dashboard-spec_2026-02-27.md`로 별도 분리. FE 에이전트 팀에 독립 전달 가능.

### 9.3 공유 상태 구조 (Zustand)

```typescript
// 모든 뷰가 공유하는 에이전트 상태
interface AgentStore {
  agents: Map<string, AgentLiveState>;
  activeView: 'dashboard' | 'pixel' | 'timeline';
  selectedAgentId: string | null;

  // WebSocket 연결
  connected: boolean;
  reconnecting: boolean;

  // 필터
  sourceFilter: AgentSourceType[];
  teamFilter: string[];
  statusFilter: string[];

  // Actions
  setAgent(state: AgentLiveState): void;
  removeAgent(id: string): void;
  selectAgent(id: string | null): void;
  setView(view: string): void;
}
```

---

## 10. 구현 로드맵 (보강)

### Phase 1: Foundation (3주)

**목표**: JSONL 수집 + 대시보드 + 최소 픽셀 뷰 프로토타입

```
Week 1: 데이터 파이프라인
  □ shared 패키지: UAEP-min 타입 정의 + 도구 카테고리 매핑
  □ Claude Code JSONL Collector: 파일 감시 + 파싱 + 정규화
  □ Server: EventEmitter 기반 이벤트 버스
  □ Server: State Manager (인메모리)
  □ Server: WebSocket 서버 (Socket.IO) + REST API 기본
  □ (선택) OpenClaw JSONL Collector: 파일 감시 + 파싱

Week 2: 대시보드 UI (→ FE 팀에 위임 가능)
  □ React 앱 스캐폴딩 (Vite + Tailwind + Zustand)
  □ Socket.IO 연결 + useSocket/useAgents 훅
  □ Agent Card 컴포넌트 (상태, 현재 도구, 메트릭)
  □ Activity Feed (실시간 이벤트 스트림)
  □ Metrics Panel (토큰, 비용, 도구 카테고리 분포)
  □ Agent Relationship Graph (부모-자식)
  → 상세: FE-dashboard-spec 문서 참조

Week 3: 안정화 + 최소 픽셀 PoC
  □ 에러 처리 & WebSocket 재연결
  □ 다중 프로젝트/에이전트 그룹 지원
  □ 설정 UI (감시 경로, 새로고침 간격)
  □ Docker Compose 원클릭 실행
  □ (PoC) Canvas에 캐릭터 1개 + 상태 전환 시연
```

### Phase 2: Pixel + Timeline (4주)

```
Week 4-5: 픽셀 엔진
  □ Canvas 2D 게임 루프 (requestAnimationFrame)
  □ 스프라이트 시스템 (SpriteData string[][], 오프스크린 캐시)
  □ 캐릭터 렌더러 (6+ 디자인, 상태별 애니메이션)
  □ 오피스 레이아웃 (타일, 벽, 가구, z-sort)
  □ 카메라 (줌, 패닝, 픽셀 퍼펙트 DPR)
  □ BFS 패스파인딩

Week 6-7: 연동 + 타임라인
  □ UAEP → 캐릭터 상태 매핑
  □ 말풍선 시스템 (도구명, 에러, 대기)
  □ 캐릭터 클릭 → 상세 사이드패널
  □ 서브에이전트 시각적 표현 (작은 캐릭터 연결선)
  □ 레이아웃 에디터 (기본)
  □ 타임라인 뷰 (Gantt 스타일, 시간축 줌)
  □ 대시보드 ↔ 픽셀 ↔ 타임라인 전환
```

### Phase 3: Multi-Source & Scale (3주)

```
Week 8-9: 다중 소스 + 영속
  □ OpenClaw JSONL Collector (본격)
  □ Agent SDK Hook Collector (HTTP Webhook)
  □ 범용 HTTP Collector (REST API)
  □ Redis Streams 이벤트 버스
  □ SQLite 히스토리 저장
  □ 세션 재생 (Playback)

Week 10: 분석 + 외부 연동
  □ 비용/토큰 분석 대시보드
  □ 에이전트 그룹/팀 관리 UI
  □ (선택) OTel Exporter → Grafana/Langfuse 연동
  □ API 문서 (OpenAPI)
```

### Phase 4: Polish & Extend

```
  □ 알림 시스템 (에러, 비용 임계치, Slack/Discord)
  □ 다중 사용자 / JWT 인증
  □ 레이아웃 저장/공유 (JSON export/import)
  □ 커스텀 스프라이트 업로드
  □ 플러그인 시스템 (커스텀 Collector)
  □ L3: 세션 리플레이어 + 감사 뷰
```

---

## 11. 프로젝트 구조

```
agent-observatory/
├── packages/
│   ├── shared/                    # UAEP 타입, 유틸, 도구 카테고리 맵
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── uaep.ts        # UAEP-min + Full 이벤트 타입
│   │   │   │   ├── agent.ts       # AgentLiveState
│   │   │   │   ├── metrics.ts     # 메트릭 타입
│   │   │   │   └── api.ts         # REST API 요청/응답 타입
│   │   │   └── utils/
│   │   │       ├── eventId.ts     # UUID v7
│   │   │       ├── toolCategory.ts # 도구→카테고리 매핑
│   │   │       └── validation.ts  # 이벤트 검증 (Zod)
│   │   └── package.json
│   │
│   ├── collectors/                # 수집 계층
│   │   ├── src/
│   │   │   ├── base.ts            # Collector 인터페이스/추상 클래스
│   │   │   ├── claude-code/       # Claude Code JSONL
│   │   │   │   ├── watcher.ts
│   │   │   │   ├── parser.ts
│   │   │   │   └── normalizer.ts
│   │   │   ├── openclaw/          # OpenClaw JSONL (신규)
│   │   │   │   ├── watcher.ts
│   │   │   │   ├── parser.ts
│   │   │   │   └── normalizer.ts
│   │   │   ├── agent-sdk/         # Agent SDK Hooks
│   │   │   │   ├── webhook.ts
│   │   │   │   └── normalizer.ts
│   │   │   └── http/              # 범용 HTTP
│   │   │       └── endpoint.ts
│   │   └── package.json
│   │
│   ├── server/                    # 처리 + 전달 계층
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── eventBus/
│   │   │   │   ├── memory.ts      # EventEmitter (Phase 1)
│   │   │   │   ├── redis.ts       # Redis Streams (Phase 2)
│   │   │   │   └── interface.ts   # 공통 인터페이스
│   │   │   ├── state/
│   │   │   │   └── stateManager.ts
│   │   │   ├── metrics/
│   │   │   │   └── aggregator.ts
│   │   │   ├── history/
│   │   │   │   ├── jsonlStore.ts  # Phase 1
│   │   │   │   └── sqliteStore.ts # Phase 2
│   │   │   ├── delivery/
│   │   │   │   └── websocket.ts   # Socket.IO
│   │   │   ├── api/               # REST 라우트
│   │   │   │   ├── agents.ts
│   │   │   │   ├── sessions.ts
│   │   │   │   ├── metrics.ts
│   │   │   │   └── config.ts
│   │   │   └── otel/              # Phase 3
│   │   │       └── exporter.ts
│   │   └── package.json
│   │
│   └── web/                       # 표현 계층
│       ├── src/
│       │   ├── App.tsx
│       │   ├── stores/
│       │   │   ├── agentStore.ts  # Zustand: 에이전트 상태
│       │   │   ├── metricsStore.ts
│       │   │   └── uiStore.ts
│       │   ├── hooks/
│       │   │   ├── useSocket.ts
│       │   │   ├── useAgents.ts
│       │   │   └── useMetrics.ts
│       │   ├── views/
│       │   │   ├── Dashboard/     # → FE-dashboard-spec 참조
│       │   │   │   ├── DashboardView.tsx
│       │   │   │   ├── AgentCardGrid.tsx
│       │   │   │   ├── AgentCard.tsx
│       │   │   │   ├── ActivityFeed.tsx
│       │   │   │   ├── MetricsPanel.tsx
│       │   │   │   ├── ToolDistribution.tsx
│       │   │   │   └── RelationshipGraph.tsx
│       │   │   ├── PixelOffice/
│       │   │   │   ├── PixelView.tsx
│       │   │   │   └── PixelCanvas.tsx
│       │   │   └── Timeline/
│       │   │       ├── TimelineView.tsx
│       │   │       └── GanttChart.tsx
│       │   ├── pixel/             # 픽셀 엔진
│       │   │   ├── engine/
│       │   │   ├── sprites/
│       │   │   ├── entities/
│       │   │   └── layout/
│       │   └── components/        # 공통 UI 컴포넌트
│       │       ├── AppShell.tsx
│       │       ├── ViewSwitcher.tsx
│       │       ├── AgentDetailPanel.tsx
│       │       └── SettingsDialog.tsx
│       ├── public/sprites/
│       └── package.json
│
├── docker-compose.yml
├── pnpm-workspace.yaml
└── README.md
```

---

## 12. 핵심 설계 결정 & 트레이드오프

### 12.1 왜 UAEP-min으로 시작하는가? (OTel 직접 채택 vs 커스텀)

```
OTel 직접 채택:
  + 수집/저장/시각화 생태계 즉시 활용 (Jaeger, Grafana, Langfuse)
  + OpenClaw는 이미 OTel export 방향
  - 픽셀 UI에 필요한 "행동 카테고리" 등 시각화 힌트가 표준에 없음
  - Full replay(L3)까지 OTel만으로 부족
  - Claude Code에는 OTel 계측이 없어 어차피 커스텀 수집 필요

UAEP-min으로 시작:
  + 픽셀/대시보드에 최적화된 최소 이벤트 정의 가능
  + JSONL 기반 단순성 (파일 재생, 디버깅 용이)
  + Phase 3에서 OTel Exporter를 붙이면 양쪽 세계의 장점 획득
  - 재발명 리스크 (검색/저장/권한은 직접 구현 필요)

결론: UAEP-min → 필요 시 OTel Exporter 추가 (2단계 전략)
```

### 12.2 왜 pixel-agents를 포크하지 않는가?

```
포크 단점:
  - VS Code webview API 종속이 깊음 (acquireVsCodeApi, postMessage)
  - useExtensionMessages 훅이 전체 상태 흐름의 중심
  - "분리"하는 작업량 ≒ 새로 만드는 작업량

결론: 새로 만들되, 핵심 패턴만 참고
  - SpriteData string[][] 구조
  - 오프스크린 캐시 (zoom별 WeakMap)
  - 픽셀 퍼펙트 렌더링 (DPR, imageSmoothingEnabled=false)
  - BFS 패스파인딩, z-sort, 캐릭터 상태머신
```

### 12.3 대시보드를 왜 별도 문서로 분리하는가?

```
이유:
  1. 대시보드는 DOM 기반 React 컴포넌트 → FE 전문 팀이 빠르게 구현 가능
  2. 픽셀 뷰는 Canvas 2D 게임 엔진 → 다른 스킬셋 필요
  3. 두 팀이 병렬 작업하려면 인터페이스 경계가 명확해야 함
  4. 공유 계약: Zustand Store 스키마 + WebSocket 이벤트 포맷 + REST API

분리 경계:
  - 공통: packages/shared (타입), stores/ (Zustand), hooks/ (useSocket/useAgents)
  - 대시보드 전용: views/Dashboard/** (FE 팀 영역)
  - 픽셀 전용: views/PixelOffice/** + pixel/** (별도 팀 영역)
```

---

## 13. 보안 & 프라이버시

```
1. 대화 내용 노출
   - JSONL에는 사용자 프롬프트 + AI 응답 포함
   - L1/L2에서는 tool_name/상태만 표시 (내용은 선택적)
   - L3 활성화 시 민감 데이터 마스킹 옵션 제공
   - 히스토리 저장 시 redaction 규칙 설정 가능

2. 네트워크 보안
   - 기본: localhost 바인딩
   - 외부 공개 시: HTTPS 필수 + API Key 또는 JWT 인증
   - Socket.IO 연결 시 토큰 검증

3. 파일시스템 접근
   - Collector는 JSONL 파일 읽기 전용
   - 에이전트 코드에 대한 쓰기 권한 불필요
   - 감시 경로는 설정으로 제한 가능
```

---

## 부록 A: 픽셀 엔진 설계 상세

```
캐릭터 상태 머신:
  idle ──[tool.start]──→ acting ──[tool.end]──→ idle
    │                       │
    │──[llm.start]────→ thinking ──[llm.end]──→ idle
    │
    │──[user.permission]──→ waiting ──[granted]──→ idle
    │
    └──[error]──→ error ──[recover]──→ idle

도구 카테고리 → 애니메이션:
  file_read    → 모니터 응시, 눈 움직임
  file_write   → 타이핑 모션, 키보드 이펙트
  command      → 터미널 화면 텍스트 스크롤
  search       → 돋보기 아이콘
  web          → 브라우저 아이콘
  planning     → 화이트보드 앞에 서기
  thinking     → "..." 말풍선, 전구 아이콘
  communication → 말풍선 대화
  other        → 기본 작업 모션

엔진 컴포넌트:
  GameLoop           → requestAnimationFrame, delta time 계산
  Renderer           → clear → tiles → furniture → characters → bubbles (z-sort)
  SpriteManager      → 로딩/캐싱, 오프스크린 canvas per zoom level
  Camera             → viewport offset, integer zoom (1x-4x), 패닝
  CharacterEntity    → 상태머신 + 현재 애니메이션 프레임 + 위치
  BubbleEntity       → 텍스트 + 아이콘 + fade 타이머
  PathfindingBFS     → 타일 그리드 기반 최단경로
```

## 부록 B: UAEP-min 이벤트 예시

```json
{"ts":"2026-02-27T10:30:00Z","event_id":"019500a1","source":"claude_code","agent_id":"cc-t1","session_id":"s1","type":"session.start","data":{"cwd":"/project","model":"claude-opus-4-6"}}

{"ts":"2026-02-27T10:30:01Z","event_id":"019500a2","source":"claude_code","agent_id":"cc-t1","session_id":"s1","type":"user.input","data":{"summary":"Fix auth bug in login.ts"}}

{"ts":"2026-02-27T10:30:02Z","event_id":"019500a3","source":"claude_code","agent_id":"cc-t1","session_id":"s1","type":"agent.status","data":{"status":"thinking"}}

{"ts":"2026-02-27T10:30:03Z","event_id":"019500a4","source":"claude_code","agent_id":"cc-t1","session_id":"s1","span_id":"t1","type":"tool.start","data":{"tool_name":"Read","tool_category":"file_read","summary":"src/auth/login.ts"}}

{"ts":"2026-02-27T10:30:04Z","event_id":"019500a5","source":"claude_code","agent_id":"cc-t1","session_id":"s1","span_id":"t1","type":"tool.end","data":{"tool_name":"Read","tool_category":"file_read","duration_ms":850,"success":true}}

{"ts":"2026-02-27T10:30:10Z","event_id":"019500a6","source":"openclaw","agent_id":"oc-research","agent_name":"Research Agent","session_id":"s2","team_id":"team-alpha","type":"tool.start","span_id":"t2","data":{"tool_name":"web_search","tool_category":"search","summary":"OAuth2 best practices"}}

{"ts":"2026-02-27T10:30:15Z","event_id":"019500a7","source":"claude_code","agent_id":"cc-t1","session_id":"s1","span_id":"t3","parent_span_id":"t1","type":"subagent.spawn","data":{"child_agent_id":"sub-test","child_agent_name":"Test Runner","task_description":"Run auth tests"}}
```
