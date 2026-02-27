import { AgentSourceType } from "./agent";

export type UAEPEventType =
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

export interface UAEPEvent {
    ts: string;
    seq?: number;

    event_id: string;
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
