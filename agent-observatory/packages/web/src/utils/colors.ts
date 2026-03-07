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
    omx: '#22c55e',
    codex: '#22c55e',
    opencode: '#14b8a6',
    agent_sdk: '#06b6d4',
    langchain: '#ec4899',
    crewai: '#10b981',
    custom: '#9ca3af',
    mission_control: '#6366f1',
    pm2: '#f43f5e',
};

export const SOURCE_LABELS: Record<AgentSourceType, string> = {
    claude_code: 'CC',
    openclaw: 'OC',
    omx: 'OMX',
    codex: 'Codex',
    opencode: 'OpenCode',
    agent_sdk: 'SDK',
    langchain: 'LC',
    crewai: 'Crew',
    custom: '⚙️',
    mission_control: 'MC',
    pm2: 'PM2',
};

/** model_id → 뱃지 배경색 */
export function getModelBadgeColor(modelId: string | undefined): string {
    if (!modelId) return '#6b7280';
    const id = modelId.toLowerCase();
    if (id.includes('opus')) return '#f59e0b';
    if (id.includes('sonnet')) return '#a855f7';
    if (id.includes('haiku')) return '#14b8a6';
    if (id.includes('codex')) return '#3b82f6';
    if (id.includes('gemini')) return '#10b981';
    if (id.includes('gpt')) return '#06b6d4';
    if (id.includes('claude')) return '#a855f7';
    return '#6b7280';
}

/** model_id에서 `4-6` 또는 `4.6` 형태의 버전을 추출해 `4.6` 문자열로 반환 */
function extractVersion(id: string): string | null {
    // dot-separated: 4.6, 5.3
    const dotM = id.match(/(\d{1,2}\.\d{1,3})/);
    if (dotM) return dotM[1];
    // hyphen-separated short nums (not 8-digit date): 4-6, 4-5
    const hypM = id.match(/(\d{1,2})-(\d{1,2})(?![\d])/);
    if (hypM) return `${hypM[1]}.${hypM[2]}`;
    return null;
}

/** model_id → 짧은 표시 이름 (차트/뱃지 용) */
export function getModelShortName(modelId: string | undefined): string {
    if (!modelId) return '?';
    const id = modelId.toLowerCase();
    const ver = extractVersion(id);

    // Anthropic 계열
    if (id.includes('opus')) return ver ? `Opus ${ver}` : 'Opus';
    if (id.includes('sonnet')) return ver ? `Sonnet ${ver}` : 'Sonnet';
    if (id.includes('haiku')) return ver ? `Haiku ${ver}` : 'Haiku';

    // OpenAI 계열 — codex 먼저 (gpt-5.3-codex 처럼 둘 다 포함)
    if (id.includes('codex')) {
        const variant = id.includes('spark') ? '-S' : id.includes('mini') ? '-M' : '';
        return ver ? `Cdx ${ver}${variant}` : 'Codex';
    }
    if (id.includes('gpt')) {
        return ver ? `GPT-${ver}` : 'GPT';
    }
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) {
        const m = id.match(/(o\d+)/);
        return m ? m[1].toUpperCase() : id.slice(0, 6);
    }

    // Google 계열
    if (id.includes('gemini')) {
        const variant = id.includes('flash') ? 'F' : id.includes('pro') ? 'P' : '';
        return ver ? `Gem ${ver}${variant}` : 'Gemini';
    }

    // fallback: 처음 두 세그먼트를 합쳐 최대 10자
    const parts = modelId.split('-').filter(Boolean);
    const short = parts.slice(0, 2).join('-');
    return short.length > 10 ? short.slice(0, 10) : short;
}
