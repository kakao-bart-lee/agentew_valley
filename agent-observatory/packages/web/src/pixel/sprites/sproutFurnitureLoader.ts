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
import { loadImage, extractRegionToSpriteData, desaturateSprite } from './spriteSheetLoader'

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
  // Various growth stages. We pick a few mature crop sprites.
  // Each crop is approximately 16×32 (1×2 tiles)
  const cropPositions: Array<{ x: number; y: number; w: number; h: number; label: string }> = [
    { x: 0, y: 0, w: 16, h: 32, label: 'Wheat' },
    { x: 16, y: 0, w: 16, h: 32, label: 'Carrot' },
    { x: 32, y: 0, w: 16, h: 32, label: 'Tomato' },
    { x: 48, y: 0, w: 16, h: 32, label: 'Pumpkin' },
    { x: 64, y: 0, w: 16, h: 32, label: 'Corn' },
    { x: 80, y: 0, w: 16, h: 32, label: 'Sunflower' },
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
      sprite: desaturateSprite(raw),
      backgroundTiles: 1,
    })
  }

  // ── Trees v2 (192×128) — trees and bushes ─────────────────
  // Trees are roughly 32×48 (2×3 tiles) or larger
  const treePositions: Array<{ x: number; y: number; w: number; h: number; fw: number; fh: number; label: string; bg?: number }> = [
    { x: 0, y: 0, w: 32, h: 48, fw: 2, fh: 3, label: 'Oak Tree', bg: 2 },
    { x: 32, y: 0, w: 32, h: 48, fw: 2, fh: 3, label: 'Pine Tree', bg: 2 },
    { x: 64, y: 0, w: 32, h: 48, fw: 2, fh: 3, label: 'Apple Tree', bg: 2 },
    { x: 0, y: 80, w: 16, h: 32, fw: 1, fh: 2, label: 'Bush', bg: 1 },
    { x: 16, y: 80, w: 16, h: 32, fw: 1, fh: 2, label: 'Berry Bush', bg: 1 },
    { x: 32, y: 80, w: 16, h: 16, fw: 1, fh: 1, label: 'Stump' },
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
      sprite: desaturateSprite(raw),
      backgroundTiles: tree.bg,
    })
  }

  // ── Grass Biom Things (144×80) — nature decor ─────────────────
  // Small 16×16 items: flowers, mushrooms, stones
  const naturePositions: Array<{ x: number; y: number; label: string }> = [
    { x: 0, y: 0, label: 'Flower Red' },
    { x: 16, y: 0, label: 'Flower Blue' },
    { x: 32, y: 0, label: 'Flower Yellow' },
    { x: 48, y: 0, label: 'Mushroom' },
    { x: 64, y: 0, label: 'Stone Small' },
    { x: 80, y: 0, label: 'Grass Tuft' },
    { x: 0, y: 16, label: 'Stone Large' },
    { x: 16, y: 16, label: 'Rock Pile' },
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
      sprite: desaturateSprite(raw),
    })
  }

  // ── Chest (240×96) — chests and barrels ─────────────────
  // 16×16 items, 15×6 grid
  const chestPositions: Array<{ x: number; y: number; label: string }> = [
    { x: 0, y: 0, label: 'Chest' },
    { x: 16, y: 0, label: 'Chest Open' },
    { x: 32, y: 0, label: 'Barrel' },
    { x: 48, y: 0, label: 'Crate' },
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
      sprite: desaturateSprite(raw),
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
      sprite: desaturateSprite(raw),
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
