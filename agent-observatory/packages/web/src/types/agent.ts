export type AgentStatus =
    | 'idle'
    | 'thinking'
    | 'acting'
    | 'waiting_input'
    | 'waiting_permission'
    | 'error';

export type ToolCategory =
    | 'file_read'
    | 'file_write'
    | 'command'
    | 'search'
    | 'web'
    | 'planning'
    | 'thinking'
    | 'communication'
    | 'other';

export type AgentSourceType =
    | 'claude_code'
    | 'openclaw'
    | 'agent_sdk'
    | 'langchain'
    | 'crewai'
    | 'custom';

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
