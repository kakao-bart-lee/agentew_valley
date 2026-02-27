# @agent-observatory/shared — 에이전트 가이드

## 역할
모든 패키지가 공유하는 **타입 정의 + 유틸리티**. 외부 런타임 의존성 없이 순수 TypeScript로 작성.

## 구현 태스크 (순서대로)

### 1. UAEP-min 이벤트 타입 (`src/types/uaep.ts`)
```typescript
// 반드시 구현해야 할 타입들:
export type AgentSourceType = 'claude_code' | 'openclaw' | 'agent_sdk' | 'langchain' | 'crewai' | 'custom';

export type UAEPEventType =
  | 'session.start' | 'session.end'
  | 'agent.status'
  | 'tool.start' | 'tool.end' | 'tool.error'
  | 'llm.start' | 'llm.end'
  | 'user.input' | 'user.permission'
  | 'subagent.spawn' | 'subagent.end'
  | 'metrics.usage';

export interface UAEPEvent {
  ts: string;               // ISO-8601
  seq?: number;
  event_id: string;          // UUID v7
  source: AgentSourceType;
  agent_id: string;
  agent_name?: string;
  session_id: string;
  span_id?: string;
  parent_span_id?: string;
  team_id?: string;
  type: UAEPEventType;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
```

### 2. 에이전트 상태 타입 (`src/types/agent.ts`)
```typescript
export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'waiting_input' | 'waiting_permission' | 'error';

export type ToolCategory = 'file_read' | 'file_write' | 'command' | 'search' | 'web' | 'planning' | 'thinking' | 'communication' | 'other';

export interface AgentLiveState {
  agent_id: string;
  agent_name: string;
  source: AgentSourceType;
  team_id?: string;
  status: AgentStatus;
  current_tool?: string;
  current_tool_category?: ToolCategory;
  status_detail?: string;
  last_activity: string;
  session_id: string;
  session_start: string;
  total_tokens: number;
  total_cost_usd: number;
  total_tool_calls: number;
  total_errors: number;
  tool_distribution: Record<ToolCategory, number>;
  parent_agent_id?: string;
  child_agent_ids: string[];
}
```

### 3. 메트릭 타입 (`src/types/metrics.ts`)
```typescript
export interface MetricsSnapshot {
  timestamp: string;
  active_agents: number;
  total_agents: number;
  total_tokens_per_minute: number;
  total_cost_per_hour: number;
  total_errors_last_hour: number;
  total_tool_calls_per_minute: number;
  tool_distribution: Record<ToolCategory, number>;
  source_distribution: Record<AgentSourceType, number>;
  timeseries: {
    timestamps: string[];
    tokens_per_minute: number[];
    cost_per_minute: number[];
    active_agents: number[];
    tool_calls_per_minute: number[];
    error_count: number[];
  };
}
```

### 4. API 타입 (`src/types/api.ts`)
REST API 요청/응답 타입 + WebSocket 이벤트 페이로드 타입.

### 5. 도구 카테고리 매핑 (`src/utils/tool-category.ts`)
```typescript
export const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  'Read': 'file_read', 'Glob': 'file_read', 'Grep': 'file_read',
  'Write': 'file_write', 'Edit': 'file_write', 'NotebookEdit': 'file_write',
  'Bash': 'command',
  'WebSearch': 'search',
  'WebFetch': 'web',
  'EnterPlanMode': 'planning', 'ExitPlanMode': 'planning',
  'AskUserQuestion': 'communication',
  'Task': 'communication',
};

export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORY_MAP[toolName] ?? 'other';
}
```

### 6. UUID v7 생성 (`src/utils/event-id.ts`)
시간순 정렬 가능한 UUID v7 생성 함수. 외부 라이브러리 없이 구현하거나, devDependency로 가볍게 처리.

### 7. 이벤트 검증 (`src/utils/validation.ts`)
UAEPEvent의 필수 필드 검증. Zod 사용 권장 (devDependency로 추가 가능).

### 8. index 파일
- `src/types/index.ts` — 모든 타입 re-export
- `src/utils/index.ts` — 모든 유틸 re-export
- `src/index.ts` — types + utils 통합 export

## 완료 기준
- `pnpm --filter @agent-observatory/shared build` 성공
- `pnpm --filter @agent-observatory/shared test` 통과
- 다른 패키지에서 `import { UAEPEvent, AgentLiveState } from '@agent-observatory/shared'` 가능

## 주의사항
- 런타임 의존성 추가 금지 (Zod도 optional — 없으면 수동 검증)
- Node.js 특정 API 사용 금지 (브라우저에서도 사용해야 함)
- 모든 타입에 JSDoc 주석 필수
