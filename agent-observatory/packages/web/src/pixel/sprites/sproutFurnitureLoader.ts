/**
 * Sprout Lands farm object loader.
 *
 * Loads farm objects from PNG spritesheets and converts them into
 * furniture catalog entries compatible with the existing system.
 *
 * Source files:
 * - farming-plants-v2.png (112×528) — crop patches (isDesk=true, work positions)
 * - trees-v2.png (192×128) — trees/bushes (decorative/storage)
 * - grass-biom-things.png (144×80) — flowers, mushrooms, stones (decor)
 * - chest.png (240×96) — chests/barrels (misc)
 * - basic-plants.png (96×32) — small plants
 * - basic-furniture.png (144×96) — tables, fences, misc items
 */

import type { SpriteData } from '../types'
import type { LoadedAssetData } from '../layout/furnitureCatalog'
import { loadImage, extractRegionToSpriteData } from './spriteSheetLoader'

const FARMING_PLANTS_URL = '/sprites/sprout/objects/farming-plants-v2.png'
const TREES_URL = '/sprites/sprout/objects/trees-v2.png'
const GRASS_BIOM_URL = '/sprites/sprout/objects/grass-biom-things.png'
const CHEST_URL = '/sprites/sprout/objects/chest.png'
const BASIC_FURNITURE_URL = '/sprites/sprout/objects/basic-furniture.png'

interface ExtractedFurniture {
  id: string
  label: string
  category: string
  footprintW: number
  footprintH: number
  isDesk: boolean
  sprite: SpriteData
  backgroundTiles?: number
}

export async function loadSproutFurniture(): Promise<LoadedAssetData> {
  const [farmImg, treesImg, grassImg, chestImg, furnImg] = await Promise.all([
    loadImage(FARMING_PLANTS_URL),
    loadImage(TREES_URL),
    loadImage(GRASS_BIOM_URL),
    loadImage(CHEST_URL),
    loadImage(BASIC_FURNITURE_URL),
  ])

  const items: ExtractedFurniture[] = []

  // ── Farming Plants v2 (112×528) — crop patches ─────────────────
  // Layout: 7 cols × 33 rows (16px grid). Each crop type = 2 rows (32px).
  // Growth stages go left→right (col 0=seed → col 5=mature, col 6 mostly empty).
  // We pick the most visually distinct mature stage per crop group.
  const cropPositions: Array<{ x: number; y: number; w: number; h: number; label: string }> = [
    { x: 80, y: 0,   w: 16, h: 32, label: 'Wheat' },      // G0 col5: golden wheat stalks
    { x: 80, y: 32,  w: 16, h: 32, label: 'Carrot' },      // G1 col5: orange carrots visible
    { x: 80, y: 64,  w: 16, h: 32, label: 'Turnip' },      // G2 col5: purple beet/turnip
    { x: 64, y: 256, w: 16, h: 32, label: 'Pumpkin' },     // G8 col4: orange pumpkin on vine
    { x: 64, y: 224, w: 16, h: 32, label: 'Sunflower' },   // G7 col4: yellow sunflower head
    { x: 80, y: 128, w: 16, h: 32, label: 'Corn' },        // G4 col5: golden corn/grain
  ]

  for (const crop of cropPositions) {
    const raw = extractRegionToSpriteData(farmImg, crop.x, crop.y, crop.w, crop.h)
    items.push({
      id: `crop-${crop.label.toLowerCase()}`,
      label: crop.label,
      category: 'desks',
      footprintW: 1,
      footprintH: 2,
      isDesk: true,
      sprite: raw,
      backgroundTiles: 1,
    })
  }

  // ── Trees v2 (192×128) — trees and bushes ─────────────────
  // Layout: 12 cols × 8 rows (16px grid).
  // Row 0-2: growth stages (seeds→saplings→trees). Row 3-4: fruit tree variants.
  // Row 5-6: large fruit trees (32×48 each). Row 7: stumps.
  // Bushes on right side of rows 1-3.
  const treePositions: Array<{ x: number; y: number; w: number; h: number; fw: number; fh: number; label: string; bg?: number }> = [
    { x: 0,   y: 80, w: 32, h: 48, fw: 2, fh: 3, label: 'Oak Tree', bg: 2 },    // fruit tree (apple)
    { x: 32,  y: 80, w: 32, h: 48, fw: 2, fh: 3, label: 'Pine Tree', bg: 2 },   // fruit tree (orange)
    { x: 64,  y: 80, w: 32, h: 48, fw: 2, fh: 3, label: 'Apple Tree', bg: 2 },  // fruit tree (pear)
    { x: 144, y: 16, w: 16, h: 32, fw: 1, fh: 2, label: 'Bush', bg: 1 },        // small bush (right side)
    { x: 160, y: 16, w: 16, h: 32, fw: 1, fh: 2, label: 'Berry Bush', bg: 1 },  // berry bush
    { x: 0,   y: 112, w: 16, h: 16, fw: 1, fh: 1, label: 'Stump' },             // tree stump (bottom row)
  ]

  for (const tree of treePositions) {
    const raw = extractRegionToSpriteData(treesImg, tree.x, tree.y, tree.w, tree.h)
    items.push({
      id: `tree-${tree.label.toLowerCase().replace(/\s/g, '-')}`,
      label: tree.label,
      category: 'storage',
      footprintW: tree.fw,
      footprintH: tree.fh,
      isDesk: false,
      sprite: raw,
      backgroundTiles: tree.bg,
    })
  }

  // ── Grass Biom Things (144×80) — nature decor ─────────────────
  // Layout: 9 cols × 5 rows (16px grid).
  // Row 0: tree tops + mushrooms. Row 1: tree trunks + grass + stones.
  // Row 2: fruits + flowers. Row 3: bushes + flowers. Row 4: bushes + rocks.
  const naturePositions: Array<{ x: number; y: number; label: string }> = [
    { x: 48, y: 0,  label: 'Flower Red' },     // pink mushroom (row 0, col 3)
    { x: 80, y: 48, label: 'Flower Blue' },     // blue flower (row 3, col 5)
    { x: 96, y: 48, label: 'Flower Yellow' },   // pink flower (row 3, col 6)
    { x: 64, y: 0,  label: 'Mushroom' },        // brown mushroom (row 0, col 4)
    { x: 112, y: 16, label: 'Stone Small' },    // small gray stone (row 1, col 7)
    { x: 64, y: 16, label: 'Grass Tuft' },      // grass blades (row 1, col 4)
    { x: 80, y: 64, label: 'Stone Large' },     // rock (row 4, col 5)
    { x: 96, y: 64, label: 'Rock Pile' },       // rock/grass (row 4, col 6)
  ]

  for (const nature of naturePositions) {
    const raw = extractRegionToSpriteData(grassImg, nature.x, nature.y, 16, 16)
    items.push({
      id: `nature-${nature.label.toLowerCase().replace(/\s/g, '-')}`,
      label: nature.label,
      category: 'decor',
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
      sprite: raw,
    })
  }

  // ── Chest (240×96) — chests and barrels ─────────────────
  // Items are on a 48×48 grid (5 cols × 2 rows), 16×16 sprites centered in each cell.
  // Row 0: chests (closed, variant, opening, open, open variant)
  // Row 1: barrel, barrel variant, coin animations
  const chestPositions: Array<{ x: number; y: number; label: string }> = [
    { x: 16, y: 16, label: 'Chest' },       // closed chest
    { x: 112, y: 16, label: 'Chest Open' },  // open chest
    { x: 16, y: 64, label: 'Barrel' },       // barrel
    { x: 64, y: 64, label: 'Crate' },        // barrel variant
  ]

  for (const chest of chestPositions) {
    const raw = extractRegionToSpriteData(chestImg, chest.x, chest.y, 16, 16)
    items.push({
      id: `misc-${chest.label.toLowerCase().replace(/\s/g, '-')}`,
      label: chest.label,
      category: 'misc',
      footprintW: 1,
      footprintH: 1,
      isDesk: false,
      sprite: raw,
    })
  }

  // ── Basic Furniture (144×96) — tables, signs ─────────────────
  const furnPositions: Array<{ x: number; y: number; w: number; h: number; fw: number; fh: number; label: string; cat: string; desk: boolean }> = [
    { x: 0, y: 0, w: 32, h: 32, fw: 2, fh: 2, label: 'Table', cat: 'desks', desk: true },
    { x: 32, y: 0, w: 16, h: 16, fw: 1, fh: 1, label: 'Sign', cat: 'decor', desk: false },
    { x: 48, y: 0, w: 16, h: 16, fw: 1, fh: 1, label: 'Fence Post', cat: 'wall', desk: false },
    { x: 64, y: 0, w: 16, h: 32, fw: 1, fh: 2, label: 'Well', cat: 'misc', desk: false },
  ]

  for (const furn of furnPositions) {
    const raw = extractRegionToSpriteData(furnImg, furn.x, furn.y, furn.w, furn.h)
    items.push({
      id: `furn-${furn.label.toLowerCase().replace(/\s/g, '-')}`,
      label: furn.label,
      category: furn.cat,
      footprintW: furn.fw,
      footprintH: furn.fh,
      isDesk: furn.desk,
      sprite: raw,
    })
  }

  // ── Chair equivalent: work positions next to crop patches ──────
  items.push({
    id: 'chair',
    label: 'Work Spot',
    category: 'chairs',
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    // Transparent 16×16 sprite — character just stands here
    sprite: Array.from({ length: 16 }, () => Array(16).fill('') as string[]),
  })

  // Build LoadedAssetData
  const catalog = items.map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    width: item.sprite[0]?.length ?? 16,
    height: item.sprite.length,
    footprintW: item.footprintW,
    footprintH: item.footprintH,
    isDesk: item.isDesk,
    ...(item.backgroundTiles ? { backgroundTiles: item.backgroundTiles } : {}),
  }))

  const sprites: Record<string, SpriteData> = {}
  for (const item of items) {
    sprites[item.id] = item.sprite
  }

  return { catalog, sprites }
}
