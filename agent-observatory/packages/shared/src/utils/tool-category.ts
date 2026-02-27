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

  // command
  'Bash': 'command',

  // search
  'WebSearch': 'search',

  // web
  'WebFetch': 'web',

  // planning
  'EnterPlanMode': 'planning',
  'ExitPlanMode': 'planning',

  // communication
  'AskUserQuestion': 'communication',
  'Task': 'communication',
};

/**
 * 도구 이름에 해당하는 행동 카테고리를 반환한다.
 *
 * 매핑 테이블에 없는 도구 이름은 `'other'`를 반환한다.
 *
 * @param toolName - 도구 이름 (예: "Read", "Bash", "WebSearch")
 * @returns 해당 도구의 행동 카테고리
 */
export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORY_MAP[toolName] ?? 'other';
}
