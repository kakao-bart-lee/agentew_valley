# (2) 시각화/추상화 연구 — 서로 다른 에이전트 로그를 “규격화 → 집계 → 여러 UI로 출력” (2026-02-27)

작성 목적:
- (1)에서 조사한 **로그/세션 구조의 차이(Claude Code vs OpenClaw vs 기타)**를 전제로,
- 서로 다른 에이전트/스웜의 활동 로그를 **공통 규격으로 정규화**하고,
- 이를 **대시보드**(지표/타임라인)와 **픽셀 뷰어**(pixel-agents 스타일) 모두에서 볼 수 있게 하는 아키텍처/추상화 방법을 정리.

전제:
- “본체 소스코드 수정”은 하지 않고, 설계/연구 중심.
- Pixel Agents의 픽셀 렌더링/Canvas 구조 분석은 별도 문서 참고:
  - `/Users/joy/workspace/agent_online_workspace/pixel-agents_분석정리_2026-02-27.md`
- 더 자세한 독립 웹서비스 설계 초안(UAEP 포함)은 별도 문서 참고:
  - `/Users/joy/workspace/agent_online_workspace/agent-observatory-architecture_2026-02-27.md`

---

## 0) 목표를 “출력 UI 기준”으로 쪼개기

UI가 필요로 하는 데이터는 레벨별로 다릅니다.

| 레벨 | UI 예 | 필요한 이벤트 |
|---|---|---|
| L1 “지금 뭐함” | 픽셀 캐릭터/상태 보드 | tool.start/end, agent.status, waiting, error |
| L2 “언제 뭐했나” | 타임라인/간트 | timestamped 이벤트 + parent/child 관계 |
| L3 “무엇을 했나(내용)” | 세션 리플레이어 | transcript 원문 + 안정 스키마 + 민감정보 처리 |

Pixel/pixel-agents 스타일은 기본적으로 L1~L2에 최적화되어 있고,
대시보드는 L1~L2 + 간단 메트릭이 핵심입니다.

---

## 1) 통합 규격(표준화) 선택지

### 선택지 A) OpenTelemetry + OpenInference(semantic conventions) 중심

개념:
- 각 “세션/실행”을 trace로 보고,
- 툴 호출/LLM 호출/서브에이전트를 span으로 보고,
- 표준 속성(attribute)으로 의미를 보존.

장점:
- 수집/저장/시각화 생태계가 이미 큼(collector, Jaeger/Tempo/Grafana 등)
- OpenClaw는 이미 diagnostics/OTel export 방향이 있어 자연스러움

단점:
- Pixel UI에 필요한 “애니메이션 힌트(툴 카테고리, 행동 상태)”는 추가 속성 설계가 필요
- Full replay(L3)까지는 OTel만으로는 부족할 수 있음(원문/첨부/파일 diff 등)

권장 상황:
- “장기적으로 팀/스웜 관측을 서비스로 운영”하려는 경우

### 선택지 B) 커스텀 JSONL 이벤트 프로토콜(UAEP 같은 것) 중심

개념:
- 모든 소스 로그를 **하나의 이벤트 JSONL**로 정규화
- 내부적으로는 OTel Span 모델(trace_id/span_id)을 흉내내되, UI 친화적 필드(툴 카테고리 등)를 기본 제공

장점:
- Pixel UI에 필요한 최소 이벤트를 빠르게 정의 가능
- 단순 파일 기반(JSONL)로도 playback/재생이 쉬움

단점:
- 표준 생태계를 직접 재구현하는 위험(검색/저장/알림/권한)
- 추후 OTel 연동 시 “2중 모델”이 될 수 있음

권장 상황:
- 우선 “픽셀 뷰 + 간단 대시보드”를 빠르게 만들고, 이후 OTel로 export하는 전략

### 권장(현 단계)
**내부 표준은 UAEP(또는 UAEP-min)**로 시작하고,
추후 **OTel(OpenInference) exporter를 붙여 외부 관측 툴과 연결**하는 2단계가 현실적입니다.

---

## 2) UAEP-min: 픽셀/대시보드 공통 최소 이벤트 세트

L1~L2에 필요한 최소 이벤트만 정의합니다.

### 2.1 이벤트 공통 Envelope(권장 필드)
```ts
type UAEPEvent = {
  // time/order
  ts: string;                 // ISO-8601
  seq?: number;               // (선택) 소스별 증가 시퀀스

  // identity
  source: "claude_code" | "openclaw" | "agent_sdk" | "custom";
  agent_id: string;
  session_id: string;         // 또는 trace_id
  span_id?: string;           // tool/llm 등 작업 단위
  parent_span_id?: string;    // subagent/parent 작업 연결
  team_id?: string;           // swarm/team 묶음

  // kind
  type:
    | "session.start"
    | "session.end"
    | "agent.status"
    | "tool.start"
    | "tool.end"
    | "tool.error"
    | "llm.start"
    | "llm.end"
    | "metrics.usage"
    | "subagent.spawn"
    | "subagent.end";

  // payload (type별)
  data?: Record<string, unknown>;
};
```

### 2.2 픽셀 뷰어를 위한 “툴 카테고리” 규약
Pixel 애니메이션은 “툴 이름”이 아니라 “행동 카테고리”가 더 중요합니다.

권장 카테고리:
- `file_read` (Read/Glob/Grep)
- `file_write` (Write/Edit/NotebookEdit)
- `command` (Bash/Exec)
- `search` (WebSearch)
- `web` (WebFetch/Browser)
- `planning` (EnterPlanMode/Plan)
- `thinking` (LLM reasoning 구간)
- `communication` (AskUserQuestion/SendMessage 등)
- `other`

예시:
```json
{"ts":"2026-02-27T10:00:00.000Z","source":"claude_code","agent_id":"a1","session_id":"s1","span_id":"t1","type":"tool.start","data":{"tool_name":"Read","tool_category":"file_read","summary":"Reading renderer.ts"}}
```

---

## 3) 수집 → 정규화 → 집계 → 전달(실시간) 파이프라인

### 3.1 수집(Collector) 종류
- **Claude Code JSONL tailer**: `~/.claude/projects/**.jsonl` append 추적
- **OpenClaw transcript tailer**: `~/.openclaw/agents/<agentId>/sessions/*.jsonl` append 추적
- **OpenClaw diagnostics/OTel collector**: OTLP receiver로 trace/metric 수신(옵션)
- **Agent SDK hook receiver**: HTTP webhook(PreToolUse/PostToolUse 등)
- **Custom agent event receiver**: UAEPEvent를 POST/WS로 직접 받는 범용 엔드포인트

### 3.2 정규화(Normalizer) 전략
소스별로 “완벽 변환”을 목표로 하기보다, 우선 L1~L2를 만족하는 **UAEP-min 변환**이 합리적입니다.

- Claude Code → UAEP:
  - `assistant.tool_use` → `tool.start`
  - `user.tool_result` → `tool.end`
  - `system.turn_duration` → `agent.status: waiting`
- OpenClaw → UAEP:
  - `message(role=assistant, content.toolCall/toolUse)` → `tool.start`
  - `message(role=toolResult, toolCallId/toolUseId)` → `tool.end`
  - session store updatedAt / run lifecycle / diagnostics → `session.start/end`, `metrics.usage`

### 3.3 집계(State Manager)
대시보드/픽셀 UI는 “이벤트 스트림” 그대로가 아니라, “현재 상태”가 필요합니다.

권장 라이브 상태:
- agent 현재 상태: `idle/thinking/acting/waiting/error`
- 현재 tool + category + 시작시각
- 최근 활동 시각(last_activity)
- 누적 지표(토큰/비용/툴 호출 수/에러 수)
- subagent 관계(부모/자식)

### 3.4 전달(Delivery)
실시간은 WebSocket(또는 SSE)로 충분합니다.
- 픽셀 뷰: 60fps 렌더링과는 별개로, “상태 변화 이벤트”만 100~500ms 배치로 전달
- 대시보드: 1초 단위 집계 스냅샷 + 상태 변화 delta 전달

---

## 4) Pixel Agents와의 연결(“본체 수정 없이” 가능한 수준)

Pixel Agents는 VS Code Webview 메시지(`postMessage`) 기반이며,
세션 입력은 Claude Code transcript JSONL에 강결합되어 있습니다.

따라서 “본체 수정 없이” 가능한 전략은 크게 2가지입니다.

### 전략 A) 외부 스웜 로그를 Claude Code 유사 JSONL로 변환해 `.claude/projects/`에 생성
- 장점: Pixel Agents를 그대로 재사용
- 단점: VS Code 터미널/agent 채택 제약(=새 JSONL이 생겨도 캐릭터가 자동 생성되지 않을 수 있음)

### 전략 B) Pixel 렌더링 엔진(office) 개념만 재사용한 “독립 웹 픽셀 뷰” 구축
- 장점: 외부 공개/웹서버/원격 스웜에 자연스럽게 대응
- 단점: pixel-agents UI 흐름(acquireVsCodeApi 등)과는 분리 작업 필요

현 단계 권장:
- **단기 PoC**: 전략 A로 “보이는지” 확인
- **중장기 제품화**: 전략 B(독립 웹)로 가는 것이 설계 리스크가 낮음

---

## 5) 단계별 PoC 제안(코드 수정 없이도 가능한 연구 순서)

1) **UAEP-min 스키마 확정**(문서 + 샘플 이벤트)
2) Claude Code JSONL → UAEP 변환 규칙 확정(파서 설계)
3) OpenClaw transcript/diagnostics → UAEP 변환 규칙 확정
4) “라이브 상태” 집계 규칙 확정(상태 머신)
5) 대시보드 UI(에이전트 카드 + 활동 피드 + 간단 메트릭)
6) 픽셀 UI(툴 카테고리 → 애니메이션 매핑) 설계/프로토타입

