/**
 * 도구 이름 -> 행동 카테고리 매핑.
 *
 * 픽셀 애니메이션과 대시보드 분포 차트에서 사용.
 * 도구 이름은 대소문자를 구분한다.
 */

import type { ToolCategory } from '../types/agent.js';

/**
 * 도구 이름을 행동 카테고리로 매핑하는 테이블.
 *
 * Claude Code, OpenClaw, Agent SDK 등 다양한 소스의
 * 도구 이름을 통일된 카테고리로 분류한다.
 */
export const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  // file_read
  'Read': 'file_read',
  'Glob': 'file_read',
  'Grep': 'file_read',

  // file_write
  'Write': 'file_write',
  'Edit': 'file_write',
  'NotebookEdit': 'file_write',
  'TodoWrite': 'file_write',

  // command
  'Bash': 'command',

  // search
  'WebSearch': 'search',
  'ToolSearch': 'search',

  // web
  'WebFetch': 'web',

  // planning
  'EnterPlanMode': 'planning',
  'ExitPlanMode': 'planning',

  // communication
  'AskUserQuestion': 'communication',
  'Task': 'communication',
  'Agent': 'communication',
  'Skill': 'communication',
  'TaskCreate': 'communication',
  'TaskUpdate': 'communication',
  'TaskList': 'communication',
  'TaskGet': 'communication',
  'TaskStop': 'communication',
  'TaskOutput': 'communication',

  // Codex — command
  'exec_command': 'command',
  'exec': 'command',
  'write_stdin': 'command',
  'send_input': 'command',
  'process': 'command',

  // Codex — communication / agent coordination
  'spawn_agent': 'communication',
  'close_agent': 'communication',
  'wait': 'communication',
  'request_user_input': 'communication',
  'update_plan': 'planning',
  'list_mcp_resources': 'communication',
  'list_mcp_resource_templates': 'communication',

  // OpenCode — file_write
  'apply_patch': 'file_write',

  // OpenCode / common — web
  'browser': 'web',
  'web_fetch': 'web',

  // OpenCode / common — search
  'web_search': 'search',
  'lsp_diagnostics': 'search',

  // OpenCode / common — communication
  'question': 'communication',
  'background_output': 'communication',
  'call_omo_agent': 'communication',
  'message': 'communication',
  'agents_list': 'communication',
  'subagents': 'communication',
  'gateway': 'communication',
  'nodes': 'communication',
  'sessions_list': 'communication',
  'sessions_history': 'communication',
  'sessions_spawn': 'communication',
  'sessions_send': 'communication',
  'session_status': 'communication',
};

/**
 * 도구 이름에 해당하는 행동 카테고리를 반환한다.
 *
 * 1. 정확한 이름 매칭 (대소문자 구분)
 * 2. 대소문자 무시 매칭 (소문자 도구 이름 처리)
 * 3. 접두사 패턴 매칭 (MCP 도구, websearch_* 등)
 * 4. 그 외는 `'other'`
 *
 * @param toolName - 도구 이름 (예: "Read", "bash", "mcp__claude-in-chrome__computer")
 * @returns 해당 도구의 행동 카테고리
 */
export function getToolCategory(toolName: string): ToolCategory {
  // 1. 정확한 매칭
  if (toolName in TOOL_CATEGORY_MAP) return TOOL_CATEGORY_MAP[toolName]!;

  // 2. 대소문자 무시 매칭
  const lower = toolName.toLowerCase();
  for (const key of Object.keys(TOOL_CATEGORY_MAP)) {
    if (key.toLowerCase() === lower) return TOOL_CATEGORY_MAP[key]!;
  }

  // 3. 접두사/패턴 매칭
  if (lower.startsWith('mcp__claude-in-chrome__') || lower.startsWith('mcp__browser__') || lower.startsWith('mcp__playwright__')) {
    return 'web';
  }
  if (lower.startsWith('websearch') || lower.startsWith('grep_app_search') || lower.startsWith('context7_') || lower.startsWith('mcp__omx_code_intel__')) {
    return 'search';
  }
  if (lower.startsWith('mcp__linear__') || lower.startsWith('mcp__omx_')) {
    return 'communication';
  }

  return 'other';
}
