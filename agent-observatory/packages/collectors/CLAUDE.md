# @agent-observatory/collectors — 에이전트 가이드

## 역할
에이전트 소스별 로그를 감시/파싱하여 UAEP 이벤트로 정규화하는 **수집기(Collector)** 패키지.

## 핵심 참고 문서
- **JSONL 파싱 규칙**: `docs/01_agent_session_logging_research_2026-02-27.md`
  - §1.2: Claude Code JSONL 레코드 타입
  - §1.3: Pixel Agents가 기대하는 최소 JSONL 부분집합 (tool_use, tool_result, turn_duration, progress)
  - §2.4: OpenClaw transcript JSONL 구조 (session 헤더, tree 구조, toolCall/toolResult)
  - §3: Claude Code ↔ OpenClaw 호환성 분석
- **변환 매핑**: 아키텍처 문서 §5.4 (소스별 → UAEP 변환 매핑 테이블)

## 의존성
- `@agent-observatory/shared` (UAEP 타입, 도구 카테고리 매핑)
- `chokidar` (파일 감시)

## 구현 태스크

### 1. Collector 기본 인터페이스 (`src/base.ts`)
```typescript
import { UAEPEvent, AgentSourceType } from '@agent-observatory/shared';

export interface CollectorConfig {
  watchPaths: string[];
  // 추가 옵션은 소스별로 확장
}

export interface Collector {
  readonly name: string;
  readonly sourceType: AgentSourceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: UAEPEvent) => void): void;
}
```

### 2. Claude Code JSONL Collector (`src/claude-code/`)

#### watcher.ts
```
- chokidar로 ~/.claude/projects/**/*.jsonl 감시
- 새 파일 생성 → session.start 이벤트 생성
- 파일 append → tail 방식 새 줄 읽기 (오프셋 관리)
- 파일 삭제 → session.end 이벤트 생성
- 초기 로딩: 기존 파일들의 마지막 N줄 읽어 현재 상태 복원
```

#### parser.ts
```
Claude Code JSONL 파싱 규칙 (방어적 파싱):

1. 각 줄을 JSON.parse → type 필드 확인
2. 알려진 type만 처리, 미지 type은 무시(로그만)

처리 대상:
  type: "assistant" → message.content[] 순회
    → content.type === "tool_use" → tool.start 이벤트
       필드: { id, name, input }

  type: "user" → message.content[] 순회
    → content.type === "tool_result" → tool.end 이벤트
       필드: { tool_use_id, content }
    → content.type === "text" (첫 user 메시지) → user.input 이벤트

  type: "system", subtype: "turn_duration" → agent.status: idle (대기 전환)
    필드: { duration_ms }

  type: "progress" → data.type 확인
    → "agent_progress" → subagent.spawn + 중첩 tool_use 재귀 파싱
    → "bash_progress", "mcp_progress" → 무시 가능 (L1에서 불필요)

핵심: tool_use.id와 tool_result.tool_use_id 매칭으로 active tool set 관리
```

#### normalizer.ts
```
Claude Code 레코드 → UAEPEvent 변환:
  - agent_id: "cc-{sessionFile의 UUID 앞 8자}"
  - agent_name: "Claude Code #{순번}"
  - session_id: JSONL 파일명(UUID)
  - source: "claude_code"
  - tool.start의 span_id: tool_use.id
  - tool.end에서 duration_ms: (tool.end 타임스탬프 - tool.start 타임스탬프)
  - tool_category: getToolCategory(tool_name)
```

### 3. OpenClaw JSONL Collector (`src/openclaw/`)

#### watcher.ts
```
- ~/.openclaw/agents/*/sessions/ 하위 감시
- sessions.json 변화 → 활성 세션 목록 갱신
- *.jsonl 파일 append → tail 방식 파싱
```

#### parser.ts
```
OpenClaw JSONL 파싱 규칙:

1. 첫 줄: type: "session" → 세션 메타 추출 (version, id, cwd)
2. 이후:
   type: "message" → message.role 확인
     role: "user" → user.input
     role: "assistant" → message.content[] 순회
       → type: "toolCall" | "toolUse" | "functionCall" → tool.start
     role: "toolResult" → tool.end
       연결: toolCallId / toolUseId

3. 트리 구조(id, parentId)는 L2+에서 필요 — L1에서는 무시 가능
4. type: "compaction", "branch_summary", "custom" → 무시
```

#### normalizer.ts
```
OpenClaw 레코드 → UAEPEvent 변환:
  - agent_id: "oc-{agentId 앞 8자}"
  - agent_name: "OpenClaw {agentId}"
  - session_id: OpenClaw의 sessionId
  - source: "openclaw"
  - 도구명 매핑: OpenClaw 도구명 → ToolCategory (알 수 없으면 "other")
```

### 4. Agent SDK Hook Collector (`src/agent-sdk/`)
Phase 1에서는 스텁만 생성. HTTP webhook 수신 엔드포인트.

### 5. HTTP Collector (`src/http/`)
Phase 1에서는 스텁만 생성. 범용 UAEP POST 수신 엔드포인트.

### 6. 통합 export (`src/index.ts`)
```typescript
export { ClaudeCodeCollector } from './claude-code/index.js';
export { OpenClawCollector } from './openclaw/index.js';
export type { Collector, CollectorConfig } from './base.js';
```

## 테스트 전략

### 필수 테스트 파일
```
src/__tests__/
├── fixtures/
│   ├── claude-code-sample.jsonl     — 실제 CC transcript 샘플 (민감 데이터 제거)
│   ├── claude-code-subagent.jsonl   — 서브에이전트 포함 샘플
│   ├── openclaw-sample.jsonl        — 실제 OC transcript 샘플
│   └── openclaw-with-tools.jsonl    — 도구 호출 포함 샘플
├── claude-code-parser.test.ts
├── claude-code-normalizer.test.ts
├── openclaw-parser.test.ts
└── openclaw-normalizer.test.ts
```

### 테스트 케이스 (최소)
1. 단일 tool_use + tool_result → tool.start + tool.end 이벤트 쌍
2. 다중 tool_use (병렬) → 각각 독립적 tool.start
3. turn_duration → agent.status: idle
4. 서브에이전트 progress → subagent.spawn + 중첩 tool 이벤트
5. 잘못된 JSON 줄 → 무시하고 계속 (크래시 안 함)
6. 빈 파일 → session.start만 발행
7. OpenClaw session 헤더 파싱
8. OpenClaw toolCall → tool.start 변환

## 완료 기준
- `pnpm --filter @agent-observatory/collectors test` 전체 통과
- 실제 JSONL 파일(Claude Code/OpenClaw)로 파싱 데모 성공
- `ClaudeCodeCollector.onEvent()` → UAEPEvent 스트림 확인
- `OpenClawCollector.onEvent()` → UAEPEvent 스트림 확인

## 주의사항
- JSONL 파일 읽기 전용 — 절대 수정/삭제하지 않음
- 민감 데이터(대화 내용): tool.start/end에서는 tool_name + input summary만 추출
- 대화 원문은 L3에서만 다룸 — 이 단계에서는 무시
- 파일 감시 안정성: chokidar의 usePolling은 기본 false (성능), NFS 등에서만 true
- 오프셋 관리: 파일별 Map<filePath, byteOffset> 인메모리 보관
