/** Map status prefixes back to tool names for animation selection */
export const STATUS_TO_TOOL: Record<string, string> = {
  'Reading': 'Read',
  'Searching': 'Grep',
  'Globbing': 'Glob',
  'Fetching': 'WebFetch',
  'Searching web': 'WebSearch',
  'Writing': 'Write',
  'Editing': 'Edit',
  'Running': 'Bash',
  'Task': 'Task',
}

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool
  }
  const first = status.split(/[\s:]/)[0]
  return first || null
}

import { DEFAULT_COLS, DEFAULT_ROWS, TILE_SIZE, ZOOM_MIN, ZOOM_MAX } from './constants'

/** Compute a default integer zoom level that fits the map within the viewport */
export function defaultZoom(mapCols?: number, mapRows?: number): number {
  const cols = mapCols ?? DEFAULT_COLS
  const rows = mapRows ?? DEFAULT_ROWS
  const dpr = window.devicePixelRatio || 1
  const vpW = window.innerWidth * dpr
  const vpH = window.innerHeight * dpr * 0.85  // UI chrome allowance
  const fitZoom = Math.min(vpW / (cols * TILE_SIZE), vpH / (rows * TILE_SIZE))
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor(fitZoom)))
}
