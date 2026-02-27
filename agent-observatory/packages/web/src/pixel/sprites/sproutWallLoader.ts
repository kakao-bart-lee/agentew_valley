/**
 * Sprout Lands fence wall loader.
 *
 * Loads Fences.png (64×64, 16px grid → 4×4 = 16 tiles)
 * and maps to the existing 4-bit bitmask auto-tile system.
 * Desaturates for colorize compatibility.
 *
 * Bitmask convention: N=1, E=2, S=4, W=8  (same as wallTiles.ts)
 *
 * Fences.png layout (4×4 grid, 16px each):
 * The sprout-lands fence tileset uses a specific auto-tile arrangement.
 * We map each bitmask to the correct tile position.
 */

import type { SpriteData } from '../types'
import { loadImage, extractRegionToSpriteData, desaturateSprite } from './spriteSheetLoader'
import { setWallSprites } from '../wallTiles'

const FENCES_URL = '/sprites/sprout/tilesets/fences.png'
const TILE = 16

/**
 * Bitmask → (col, row) mapping for the fences tileset.
 * Fences.png follows a standard RPG Maker-style auto-tile layout.
 * Each index corresponds to the bitmask value (0-15).
 *
 * Layout:
 *  Row 0: isolated, dead-end-S, dead-end-E, corner-SE
 *  Row 1: dead-end-N, vertical, corner-NE, T-east
 *  Row 2: dead-end-W, corner-SW, horizontal, T-south
 *  Row 3: corner-NW, T-west, T-north, cross
 */
const BITMASK_TO_TILE: Array<[number, number]> = [
  [0, 0],  // 0:  no neighbors — isolated post
  [0, 1],  // 1:  N
  [2, 0],  // 2:  E
  [2, 1],  // 3:  N+E
  [0, 2],  // 4:  S (used as dead-end-S)
  [1, 1],  // 5:  N+S — vertical
  [0, 3],  // 6:  S+E — corner
  [1, 3],  // 7:  N+S+E — T-east
  [1, 0],  // 8:  W
  [3, 1],  // 9:  N+W — corner
  [2, 2],  // 10: E+W — horizontal
  [3, 3],  // 11: N+E+W — T-north
  [1, 2],  // 12: S+W — corner
  [3, 2],  // 13: N+S+W — T-west
  [2, 3],  // 14: S+E+W — T-south
  [3, 3],  // 15: all — cross
]

export async function loadSproutWall(): Promise<SpriteData[]> {
  const img = await loadImage(FENCES_URL)
  const sprites: SpriteData[] = BITMASK_TO_TILE.map(([col, row]) => {
    const raw = extractRegionToSpriteData(img, col * TILE, row * TILE, TILE, TILE)
    return desaturateSprite(raw)
  })
  setWallSprites(sprites)
  return sprites
}
