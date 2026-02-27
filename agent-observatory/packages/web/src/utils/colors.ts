import { AgentSourceType, AgentStatus, ToolCategory } from '../types/agent';

export const STATUS_COLORS: Record<AgentStatus, string> = {
    idle: 'text-gray-400',
    thinking: 'text-amber-400 animate-pulse',
    acting: 'text-emerald-400',
    waiting_input: 'text-blue-400',
    waiting_permission: 'text-orange-400',
    error: 'text-red-400 animate-pulse',
};

export const bgSTATUS_COLORS: Record<AgentStatus, string> = {
    idle: 'bg-gray-400',
    thinking: 'bg-amber-400 animate-pulse',
    acting: 'bg-emerald-400',
    waiting_input: 'bg-blue-400',
    waiting_permission: 'bg-orange-400',
    error: 'bg-red-400 animate-pulse',
};

export const CATEGORY_COLORS: Record<ToolCategory, string> = {
    file_read: '#3b82f6', // blue
    file_write: '#10b981', // green
    command: '#f59e0b', // amber
    search: '#8b5cf6', // purple
    web: '#06b6d4', // cyan
    planning: '#ec4899', // pink
    thinking: '#6366f1', // indigo
    communication: '#f97316', // orange
    other: '#9ca3af', // gray
};

export const SOURCE_COLORS: Record<AgentSourceType, string> = {
    claude_code: '#f97316',
    openclaw: '#8b5cf6',
    agent_sdk: '#06b6d4',
    langchain: '#ec4899',
    crewai: '#10b981',
    custom: '#9ca3af',
};

export const SOURCE_LABELS: Record<AgentSourceType, string> = {
    claude_code: 'CC',
    openclaw: 'OC',
    agent_sdk: 'SDK',
    langchain: 'LC',
    crewai: 'Crew',
    custom: '⚙️',
};
