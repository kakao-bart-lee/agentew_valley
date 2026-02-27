/**
 * Sprout Lands asset loading orchestrator.
 *
 * Loads all sprout assets in parallel using Promise.allSettled().
 * On failure, the system gracefully falls back to existing hardcoded sprites.
 */

import { loadSproutFloor } from './sproutFloorLoader'
import { loadSproutWall } from './sproutWallLoader'
import { loadCatSprites, loadCowSprites, loadChickenSprites } from './sproutCharacterLoader'
import { loadSproutFurniture } from './sproutFurnitureLoader'
import { loadSproutEmojis } from './sproutEmojiLoader'
import { setCatTemplates, setCowTemplates, setChickenTemplates, BUBBLE_PERMISSION_SPRITE, BUBBLE_WAITING_SPRITE } from './spriteData'
import { buildDynamicCatalog } from '../layout/furnitureCatalog'
import type { SpriteData } from '../types'

export interface SproutAssetLoadResult {
  floor: boolean
  wall: boolean
  cat: boolean
  cow: boolean
  chicken: boolean
  furniture: boolean
  emoji: boolean
}

/** Updated bubble sprites (set after emoji loading) */
let sproutPermissionBubble: SpriteData | null = null
let sproutWaitingBubble: SpriteData | null = null

export function getSproutBubbleSprite(type: 'permission' | 'waiting'): SpriteData {
  if (type === 'permission') return sproutPermissionBubble ?? BUBBLE_PERMISSION_SPRITE
  return sproutWaitingBubble ?? BUBBLE_WAITING_SPRITE
}

/**
 * Load all Sprout Lands assets. Each category loads independently;
 * failures are logged but don't block other categories.
 */
export async function loadAllSproutAssets(): Promise<SproutAssetLoadResult> {
  const result: SproutAssetLoadResult = {
    floor: false,
    wall: false,
    cat: false,
    cow: false,
    chicken: false,
    furniture: false,
    emoji: false,
  }

  const [
    floorResult,
    wallResult,
    catResult,
    cowResult,
    chickenResult,
    furnitureResult,
    emojiResult,
  ] = await Promise.allSettled([
    loadSproutFloor(),
    loadSproutWall(),
    loadCatSprites(),
    loadCowSprites(),
    loadChickenSprites(),
    loadSproutFurniture(),
    loadSproutEmojis(),
  ])

  // Floor
  if (floorResult.status === 'fulfilled') {
    result.floor = true
    console.log(`✓ Sprout floor: ${floorResult.value.length} grass patterns loaded`)
  } else {
    console.warn('✗ Sprout floor load failed:', floorResult.reason)
  }

  // Wall
  if (wallResult.status === 'fulfilled') {
    result.wall = true
    console.log(`✓ Sprout wall: ${wallResult.value.length} fence tiles loaded`)
  } else {
    console.warn('✗ Sprout wall load failed:', wallResult.reason)
  }

  // Cat
  if (catResult.status === 'fulfilled') {
    setCatTemplates(catResult.value)
    result.cat = true
    console.log('✓ Sprout cat sprites loaded')
  } else {
    console.warn('✗ Sprout cat load failed:', catResult.reason)
  }

  // Cow
  if (cowResult.status === 'fulfilled') {
    setCowTemplates(cowResult.value)
    result.cow = true
    console.log('✓ Sprout cow sprites loaded')
  } else {
    console.warn('✗ Sprout cow load failed:', cowResult.reason)
  }

  // Chicken
  if (chickenResult.status === 'fulfilled') {
    setChickenTemplates(chickenResult.value)
    result.chicken = true
    console.log('✓ Sprout chicken sprites loaded')
  } else {
    console.warn('✗ Sprout chicken load failed:', chickenResult.reason)
  }

  // Furniture
  if (furnitureResult.status === 'fulfilled') {
    const success = buildDynamicCatalog(furnitureResult.value)
    result.furniture = success
    if (success) {
      console.log('✓ Sprout furniture catalog built')
    } else {
      console.warn('✗ Sprout furniture catalog build returned false')
    }
  } else {
    console.warn('✗ Sprout furniture load failed:', furnitureResult.reason)
  }

  // Emoji / Bubbles
  if (emojiResult.status === 'fulfilled') {
    sproutPermissionBubble = emojiResult.value.permission
    sproutWaitingBubble = emojiResult.value.waiting
    result.emoji = true
    console.log('✓ Sprout emoji/bubble sprites loaded')
  } else {
    console.warn('✗ Sprout emoji load failed:', emojiResult.reason)
  }

  const successCount = Object.values(result).filter(Boolean).length
  const totalCount = Object.keys(result).length
  console.log(`Sprout asset loading: ${successCount}/${totalCount} categories succeeded`)

  return result
}
