/**
 * Re-export agent types from @agent-observatory/shared.
 * web 패키지는 shared에서 타입을 가져와 사용합니다.
 */
export type {
    AgentStatus,
    ToolCategory,
    AgentSourceType,
    AgentLiveState,
    AgentHierarchyNode,
} from '@agent-observatory/shared';
