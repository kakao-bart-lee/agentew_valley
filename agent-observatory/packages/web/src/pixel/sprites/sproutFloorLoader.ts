/**
 * Sprout Lands grass floor loader.
 *
 * Loads Grass.png (176×112, 16px grid → 11 cols × 7 rows)
 * and extracts 7 distinct grass patterns for floor tiles.
 * Desaturates them so the existing colorize pipeline can tint them.
 */

import type { SpriteData } from '../types'
import { loadImage, extractRegionToSpriteData } from './spriteSheetLoader'
import { setFloorSprites } from '../floorTiles'

const GRASS_URL = '/sprites/sprout/tilesets/grass.png'
const TILE = 16

/**
 * Grass.png layout (11×7 tiles):
 * The tileset contains auto-tile pieces. We pick 7 visually distinct
 * "inner" grass tiles for floor patterns 1-7.
 *
 * Selected tiles (col, row) — chosen for visual variety:
 *   Pattern 1: (1,1) — base grass
 *   Pattern 2: (2,1) — grass variant
 *   Pattern 3: (3,1) — grass variant
 *   Pattern 4: (1,2) — grass with detail
 *   Pattern 5: (2,2) — grass variant
 *   Pattern 6: (5,1) — darker patch
 *   Pattern 7: (6,1) — lighter patch
 */
const GRASS_PICKS: Array<[number, number]> = [
  [1, 1],
  [2, 1],
  [3, 1],
  [1, 2],
  [2, 2],
  [5, 1],
  [6, 1],
]

export async function loadSproutFloor(): Promise<SpriteData[]> {
  const img = await loadImage(GRASS_URL)
  const sprites: SpriteData[] = GRASS_PICKS.map(([col, row]) => {
    const raw = extractRegionToSpriteData(img, col * TILE, row * TILE, TILE, TILE)
    return raw
  })
  setFloorSprites(sprites)
  return sprites
}
