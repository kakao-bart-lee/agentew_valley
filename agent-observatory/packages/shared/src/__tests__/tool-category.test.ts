import { describe, it, expect } from 'vitest';
import { getToolCategory, TOOL_CATEGORY_MAP } from '../utils/tool-category.js';

describe('TOOL_CATEGORY_MAP', () => {
  it('should map file_read tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['Read']).toBe('file_read');
    expect(TOOL_CATEGORY_MAP['Glob']).toBe('file_read');
    expect(TOOL_CATEGORY_MAP['Grep']).toBe('file_read');
  });

  it('should map file_write tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['Write']).toBe('file_write');
    expect(TOOL_CATEGORY_MAP['Edit']).toBe('file_write');
    expect(TOOL_CATEGORY_MAP['NotebookEdit']).toBe('file_write');
  });

  it('should map command tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['Bash']).toBe('command');
  });

  it('should map search tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['WebSearch']).toBe('search');
  });

  it('should map web tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['WebFetch']).toBe('web');
  });

  it('should map planning tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['EnterPlanMode']).toBe('planning');
    expect(TOOL_CATEGORY_MAP['ExitPlanMode']).toBe('planning');
  });

  it('should map communication tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['AskUserQuestion']).toBe('communication');
    expect(TOOL_CATEGORY_MAP['Task']).toBe('communication');
    expect(TOOL_CATEGORY_MAP['Agent']).toBe('communication');
    expect(TOOL_CATEGORY_MAP['Skill']).toBe('communication');
    expect(TOOL_CATEGORY_MAP['TaskCreate']).toBe('communication');
    expect(TOOL_CATEGORY_MAP['TaskUpdate']).toBe('communication');
  });

  it('should map search tools correctly', () => {
    expect(TOOL_CATEGORY_MAP['WebSearch']).toBe('search');
    expect(TOOL_CATEGORY_MAP['ToolSearch']).toBe('search');
  });

  it('should map TodoWrite as file_write', () => {
    expect(TOOL_CATEGORY_MAP['TodoWrite']).toBe('file_write');
  });
});

describe('getToolCategory', () => {
  it('should return correct category for known tools', () => {
    expect(getToolCategory('Read')).toBe('file_read');
    expect(getToolCategory('Write')).toBe('file_write');
    expect(getToolCategory('Bash')).toBe('command');
    expect(getToolCategory('WebSearch')).toBe('search');
    expect(getToolCategory('WebFetch')).toBe('web');
    expect(getToolCategory('EnterPlanMode')).toBe('planning');
    expect(getToolCategory('AskUserQuestion')).toBe('communication');
  });

  it('should return "other" for unknown tools', () => {
    expect(getToolCategory('UnknownTool')).toBe('other');
    expect(getToolCategory('')).toBe('other');
    expect(getToolCategory('custom_search')).toBe('other');
  });

  it('should be case-insensitive for known tools', () => {
    expect(getToolCategory('read')).toBe('file_read');
    expect(getToolCategory('BASH')).toBe('command');
    expect(getToolCategory('websearch')).toBe('search');
    expect(getToolCategory('edit')).toBe('file_write');
    expect(getToolCategory('glob')).toBe('file_read');
  });

  it('should handle MCP tool prefixes', () => {
    expect(getToolCategory('mcp__claude-in-chrome__computer')).toBe('web');
    expect(getToolCategory('mcp__claude-in-chrome__navigate')).toBe('web');
  });

  it('should handle websearch_ prefix tools', () => {
    expect(getToolCategory('websearch_web_search_exa')).toBe('search');
    expect(getToolCategory('grep_app_searchGitHub')).toBe('search');
  });
});
