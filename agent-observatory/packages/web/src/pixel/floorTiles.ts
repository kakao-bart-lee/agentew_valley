/**
 * Floor tile pattern storage and caching.
 *
 * Stores 7 grayscale floor patterns loaded from floors.png.
 * Uses shared colorize module for HSL tinting (Photoshop-style Colorize).
 * Caches colorized SpriteData by (pattern, h, s, b, c) key.
 */

import type { SpriteData, FloorColor } from './types'
import { getColorizedSprite, clearColorizeCache } from './colorize'
import { TILE_SIZE, FALLBACK_FLOOR_COLOR } from './constants'

/** Default solid gray 16×16 tile used when floors.png is not loaded */
const DEFAULT_FLOOR_SPRITE: SpriteData = Array.from(
  { length: TILE_SIZE },
  () => Array(TILE_SIZE).fill(FALLBACK_FLOOR_COLOR) as string[],
)

/** Module-level storage for floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = []

/** Wall color constant */
export const WALL_COLOR = '#3A3A5C'

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites
  clearColorizeCache()
}

/** Get the raw (grayscale) floor sprite for a pattern index (1-7 -> array index 0-6).
 *  Falls back to the default solid gray tile when floors.png is not loaded. */
export function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1
  if (idx < 0) return null
  if (idx < floorSprites.length) return floorSprites[idx]
  // No PNG sprites loaded — return default solid tile for any valid pattern index
  if (floorSprites.length === 0 && patternIndex >= 1) return DEFAULT_FLOOR_SPRITE
  return null
}

/** Check if floor sprites are available (always true — falls back to default solid tile) */
export function hasFloorSprites(): boolean {
  return true
}

/** Get count of available floor patterns (at least 1 for the default solid tile) */
export function getFloorPatternCount(): number {
  return floorSprites.length > 0 ? floorSprites.length : 1
}

/** Get all floor sprites (for preview rendering, falls back to default solid tile) */
export function getAllFloorSprites(): SpriteData[] {
  return floorSprites.length > 0 ? floorSprites : [DEFAULT_FLOOR_SPRITE]
}

/**
 * Check if a FloorColor is neutral (no color transformation needed).
 * Neutral means the original sprite colors should be used as-is.
 */
function isNeutralColor(color: FloorColor): boolean {
  return color.h === 0 && color.s === 0 && color.b === 0 && color.c === 0
}

/**
 * Get a colorized version of a floor sprite.
 * If color is neutral {h:0,s:0,b:0,c:0}, returns the original sprite as-is
 * (preserving PNG's native colors like Sprout Lands grass textures).
 * Otherwise uses Photoshop-style Colorize: grayscale -> HSL with given hue/saturation.
 */
export function getColorizedFloorSprite(patternIndex: number, color: FloorColor): SpriteData {
  const base = getFloorSprite(patternIndex)
  if (!base) {
    // Return a 16x16 magenta error tile
    const err: SpriteData = Array.from({ length: 16 }, () => Array(16).fill('#FF00FF'))
    return err
  }

  // Neutral color: return original sprite without colorization
  if (isNeutralColor(color)) {
    return base
  }

  const key = `floor-${patternIndex}-${color.h}-${color.s}-${color.b}-${color.c}`
  return getColorizedSprite(key, base, { ...color, colorize: true })
}
