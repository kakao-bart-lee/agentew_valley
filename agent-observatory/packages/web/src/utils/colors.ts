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
    claude_code: '#D4673A', // Anthropic orange
    openclaw:    '#CC2200', // 바닷가재(lobster) 선명한 빨강
    omx:         '#22c55e', // green
    codex:       '#10a37f', // OpenAI green
    opencode:    '#0891b2', // cyan-blue
    agent_sdk:   '#06b6d4', // cyan
    langchain:   '#ec4899', // pink
    crewai:      '#10b981', // emerald
    custom:      '#9ca3af', // gray
    mission_control: '#6366f1', // indigo
    pm2:         '#f43f5e', // rose
};

export const SOURCE_LABELS: Record<AgentSourceType, string> = {
    claude_code: 'Claude',
    openclaw: 'OpenClaw',
    omx: 'OMX',
    codex: 'Codex',
    opencode: 'OpenCode',
    agent_sdk: 'SDK',
    langchain: 'LangChain',
    crewai: 'CrewAI',
    custom: '⚙️',
    mission_control: 'MissionCtrl',
    pm2: 'PM2',
};

/** model_id → 뱃지 배경색 (provider 브랜드 색 기반, 모델별 변주) */
export function getModelBadgeColor(modelId: string | undefined): string {
    if (!modelId) return '#6b7280';
    const id = modelId.toLowerCase();
    // Anthropic 계열 — 주황 계열 (#D4673A 중심)
    if (id.includes('opus'))   return '#B85428'; // 가장 진한 주황
    if (id.includes('sonnet')) return '#D4673A'; // 기본 Anthropic 주황
    if (id.includes('haiku'))  return '#E8845A'; // 밝은 주황
    if (id.includes('claude')) return '#D4673A'; // 기타 Claude 모델
    // OpenAI 계열 — 청록/녹색 계열 (#10a37f 중심)
    if (id.includes('codex'))  return '#0EA472'; // Codex — 약간 밝은 청록
    if (id.includes('gpt'))    return '#10a37f'; // GPT — OpenAI 기본 초록
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return '#0B8A69'; // o-시리즈 — 짙은 청록
    // Google 계열 — 파랑 계열 (#4285F4 중심)
    if (id.includes('flash'))  return '#5B9EF4'; // Gemini Flash — 밝은 파랑
    if (id.includes('gemini')) return id.includes('pro') ? '#1A73E8' : '#4285F4';
    // ZhipuAI (Z.ai) 계열 — 보라 계열
    if (id === 'big-pickle')   return '#7C5CFC'; // OpenCode Zen 코드명 (GLM 4.6)
    if (id.includes('glm'))    return '#7C5CFC'; // GLM 시리즈
    // MiniMax 계열 — 하늘색 계열
    if (id.includes('minimax')) return '#0284C7';
    return '#6b7280';
}

/** model_id에서 버전을 추출해 문자열로 반환 */
function extractVersion(id: string): string | null {
    // dot-separated: 4.6, 5.3, 2.5
    const dotM = id.match(/(\d{1,2}\.\d{1,3})/);
    if (dotM) return dotM[1];
    // hyphen-separated short nums (not 8-digit date): 4-6, 4-5
    const hypM = id.match(/(\d{1,2})-(\d{1,2})(?![\d])/);
    if (hypM) return `${hypM[1]}.${hypM[2]}`;
    // gemini-style integer generation: gemini-3-flash, gemini-3-pro
    const genM = id.match(/gemini-(\d+)-/);
    if (genM) return genM[1];
    return null;
}

/** model_id → 표시 이름 (차트/뱃지 용) */
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
        const variant = id.includes('spark') ? ' Spark' : id.includes('mini') ? ' Mini' : '';
        return ver ? `Codex ${ver}${variant}` : 'Codex';
    }
    if (id.includes('gpt')) {
        return ver ? `GPT-${ver}` : 'GPT';
    }
    if (id.includes('o1') || id.includes('o3') || id.includes('o4')) {
        const m = id.match(/(o\d+)/);
        return m ? m[1].toUpperCase() : id.slice(0, 8);
    }

    // Google 계열
    if (id.includes('gemini')) {
        const variant = id.includes('flash') ? ' Flash' : id.includes('pro') ? ' Pro' : '';
        return ver ? `Gemini ${ver}${variant}` : 'Gemini';
    }

    // ZhipuAI (Z.ai) 계열
    if (id === 'big-pickle') return 'GLM (Zen)';
    if (id.includes('glm')) return ver ? `GLM-${ver}` : 'GLM';
    // MiniMax 계열
    if (id.includes('minimax')) return ver ? `MiniMax-${ver}` : 'MiniMax';

    // fallback: 처음 두 세그먼트
    const parts = modelId.split('-').filter(Boolean);
    return parts.slice(0, 2).join('-');
}
