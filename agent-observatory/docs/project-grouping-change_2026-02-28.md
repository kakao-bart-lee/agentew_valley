# project_id 필드 추가 — 에이전트 프로젝트 그루핑 (2026-02-28)

## 개요

에이전트를 **작업 디렉토리(프로젝트)** 단위로 묶어 표시하기 위해
`UAEPEvent`와 `AgentLiveState`에 `project_id` 필드를 추가했다.

`team_id`는 사용자가 명시적으로 설정해야 하지만, `project_id`는
수집기(collector)가 에이전트가 실행된 작업 디렉토리에서 **자동으로 추출**한다.

---

## 변경된 파일 목록

| 패키지 | 파일 | 변경 내용 |
|--------|------|-----------|
| `shared` | `src/types/uaep.ts` | `UAEPEvent`에 `project_id?: string` 추가 |
| `shared` | `src/types/agent.ts` | `AgentLiveState`에 `project_id?: string` 추가 |
| `collectors` | `src/claude-code/normalizer.ts` | `extractProjectId()` 함수 추가, `NormalizerContext`에 `projectId` 추가, `makeEvent()`에 포함 |
| `collectors` | `src/claude-code/index.ts` | 수동 생성 `session.start` 이벤트에 `project_id` 포함, `extractProjectId` export |
| `collectors` | `src/openclaw/normalizer.ts` | `OCNormalizerContext`에 `projectId` 추가, `updateContextFromHeader()`에서 `cwd` 추출, `makeEvent()`에 포함 |
| `server` | `src/core/state-manager.ts` | `handleSessionStart()`에서 `event.project_id → AgentLiveState.project_id` 저장 |
| `web` | `src/views/Dashboard/AgentCardGrid.tsx` | `project_id` 기준 그루핑 렌더링, `projectDisplayName()` 헬퍼 추가 |

---

## 타입 정의

### `UAEPEvent` (shared)

```typescript
export interface UAEPEvent {
  // ... 기존 필드 ...
  team_id?: string;
  project_id?: string;  // ← 추가
  type: UAEPEventType;
  // ...
}
```

### `AgentLiveState` (shared)

```typescript
export interface AgentLiveState {
  // ... 기존 필드 ...
  team_id?: string;
  project_id?: string;  // ← 추가
  status: AgentStatus;
  // ...
}
```

---

## 소스별 project_id 추출 방식

### Claude Code

Claude Code는 세션 JSONL을 다음 경로에 저장한다:

```
~/.claude/projects/{project-dir}/{session-uuid}.jsonl
```

`{project-dir}`은 작업 디렉토리(cwd)의 절대 경로에서 `/`를 `-`로 치환한 값이다.

```
/Users/joy/workspace/my-repo → -Users-joy-workspace-my-repo
```

**`extractProjectId(filePath)`** 함수가 파일 경로에서 `projects/` 다음 디렉토리명을 추출한다:

```typescript
// 입력: "/Users/joy/.claude/projects/-Users-joy-workspace-my-repo/abc-123.jsonl"
// 출력: "-Users-joy-workspace-my-repo"
extractProjectId(filePath)
```

- 서브에이전트(Task 도구로 생성된)는 부모의 `projectId`를 **상속**한다.
- JSONL 파일 경로에 `projects/` 세그먼트가 없는 경우 parent directory name으로 fallback.

#### 주의: 인코딩의 한계

`-`가 원래 슬래시(`/`)인지 경로 내 실제 대시인지 구분할 수 없다.
프런트엔드에서는 `projectId.split('-').pop()`으로 마지막 세그먼트만 표시한다.
(예: `-Users-joy-workspace-my-repo` → `my-repo`)
정확한 원본 경로는 hover 툴팁의 `title` 속성으로 전달된다.

### OpenClaw

OpenClaw 세션 헤더 첫 줄에 `cwd`가 명시되어 있다:

```json
{"type":"session","version":7,"id":"...","timestamp":"...","cwd":"/Users/joy/workspace/my-repo"}
```

**`updateContextFromHeader()`** 에서 `header.cwd`를 `ctx.projectId`에 할당한다.
OpenClaw의 `project_id`는 실제 절대 경로이므로 프런트엔드에서 `path.basename` 방식으로 디코딩 가능하다.

---

## 데이터 흐름

```
[Claude Code JSONL 파일 경로]
  → extractProjectId(filePath)
  → NormalizerContext.projectId
  → makeEvent() → UAEPEvent.project_id
  → EventBus.publish()
  → StateManager.handleSessionStart()
  → AgentLiveState.project_id
  → WebSocket 'agent:state' / 'init'
  → 프런트엔드 AgentCardGrid (project 기준 그루핑)

[OpenClaw 세션 헤더 cwd]
  → updateContextFromHeader()
  → OCNormalizerContext.projectId
  → makeEvent() → UAEPEvent.project_id
  → (이후 동일)
```

---

## 프런트엔드 그루핑 로직

`AgentCardGrid.tsx`의 `projectGroups` useMemo:

1. 루트 에이전트(`parent_agent_id` 없음)만 대상
2. `project_id` 기준 그루핑 (`undefined` → `'__none__'` 버킷)
3. project 있는 그룹 먼저, `__none__` 마지막으로 정렬
4. 각 project 그룹 내에서 parent-child 계층 렌더링 유지

`project_id`가 하나도 없는 경우(전체가 `__none__`)에는 헤더 없이 평면 렌더링한다.

---

## Pixel 뷰 연동 가이드

> **현재 Pixel 뷰는 이 변경의 대상이 아니다.** 이 섹션은 향후 연동 시 참고용이다.

### AgentLiveState에서 project_id 사용

Pixel 뷰는 WebSocket `init` 및 `agent:state` 이벤트로 `AgentLiveState`를 수신한다.
이미 `project_id` 필드가 포함되어 있으므로 **추가 서버 변경 없이** 바로 사용 가능하다.

```typescript
// PixelCanvasView.tsx 등에서
const projectId = agent.project_id;  // 바로 사용 가능
```

### 표시 이름 변환

`AgentCardGrid.tsx`의 `projectDisplayName()` 헬퍼를 공유 유틸로 이동하면
Pixel 뷰에서도 동일한 로직을 재사용할 수 있다.

```typescript
// 제안: packages/web/src/utils/project.ts 로 이동
export function projectDisplayName(projectId: string): string {
    if (projectId.startsWith('/')) {
        // OpenClaw: 실제 절대 경로
        return projectId.split('/').filter(Boolean).pop() ?? projectId;
    }
    // Claude Code: 대시 인코딩된 경로 → 마지막 세그먼트
    const segments = projectId.split('-').filter(Boolean);
    return segments.pop() ?? projectId;
}
```

### Pixel 뷰에서 project 기준 에이전트 필터링 예시

```typescript
// 특정 project의 에이전트만 Pixel에 표시하고 싶을 때
const agentsInProject = Array.from(agents.values())
    .filter(a => a.project_id === targetProjectId);
```

---

## HTTP 수집기에서 project_id 수동 설정

`POST /api/v1/events`로 이벤트를 직접 전송할 때도 `project_id`를 포함할 수 있다:

```json
{
  "type": "session.start",
  "agent_id": "my-agent-1",
  "session_id": "sess-abc",
  "source": "custom",
  "project_id": "/path/to/my/project"
}
```

HTTP 수집기(`collectors/src/http/index.ts`)도 요청 바디의 `project_id`를
`UAEPEvent`로 전달하도록 구현되어 있다.
