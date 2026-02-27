/**
 * Sprout Lands emoji/bubble sprite loader.
 *
 * Loads emoji spritesheet and speech bubble, extracts status emojis,
 * and composites them into bubble sprites compatible with the existing
 * BUBBLE_PERMISSION_SPRITE / BUBBLE_WAITING_SPRITE system.
 *
 * Emoji_Spritesheet_Free.png (160×608, 10 cols × 38 rows, 16×16 each)
 * speech_bubble_grey.png (448×192) — contains various bubble sizes
 */

import type { SpriteData } from '../types'
import { loadImage, extractRegionToSpriteData } from './spriteSheetLoader'

const EMOJI_URL = '/sprites/sprout/ui/emoji-spritesheet.png'
const BUBBLE_URL = '/sprites/sprout/ui/speech-bubble-grey.png'

/**
 * Status emoji positions in the spritesheet (col, row):
 * These are approximate — the exact positions depend on the spritesheet layout.
 * Each emoji is 16×16 pixels.
 */
const EMOJI_POSITIONS = {
  exclamation: [0, 0] as [number, number],  // ❗ → permission wait
  zzz: [1, 0] as [number, number],          // 💤 → idle/waiting
  star: [2, 0] as [number, number],          // ⭐ → working
  heart: [3, 0] as [number, number],         // ❤️ → happy
  question: [4, 0] as [number, number],      // ❓ → thinking
}

export interface SproutBubbleSprites {
  permission: SpriteData
  waiting: SpriteData
}

/**
 * Load emoji and bubble sprites.
 * Returns composite bubble sprites with emojis inside.
 */
export async function loadSproutEmojis(): Promise<SproutBubbleSprites> {
  const [emojiImg, bubbleImg] = await Promise.all([
    loadImage(EMOJI_URL),
    loadImage(BUBBLE_URL),
  ])

  // Extract individual emoji frames
  const exclamationEmoji = extractRegionToSpriteData(
    emojiImg,
    EMOJI_POSITIONS.exclamation[0] * 16,
    EMOJI_POSITIONS.exclamation[1] * 16,
    16, 16,
  )

  const zzzEmoji = extractRegionToSpriteData(
    emojiImg,
    EMOJI_POSITIONS.zzz[0] * 16,
    EMOJI_POSITIONS.zzz[1] * 16,
    16, 16,
  )

  // Extract a small speech bubble from the bubble sheet
  // The bubble sheet has various sizes; we use a small one (about 24×20)
  const bubbleBase = extractRegionToSpriteData(bubbleImg, 0, 0, 24, 20)

  // Composite: overlay emoji onto bubble center
  const permission = compositeEmojiOnBubble(bubbleBase, exclamationEmoji)
  const waiting = compositeEmojiOnBubble(bubbleBase, zzzEmoji)

  return { permission, waiting }
}

/**
 * Composite a 16×16 emoji onto a bubble sprite, centered.
 */
function compositeEmojiOnBubble(bubble: SpriteData, emoji: SpriteData): SpriteData {
  // Create a copy of the bubble
  const result: SpriteData = bubble.map((row) => [...row])

  // Center the emoji within the bubble (excluding the tail at bottom)
  const bubbleH = result.length
  const bubbleW = result[0]?.length ?? 0
  const emojiH = emoji.length
  const emojiW = emoji[0]?.length ?? 0
  const offsetX = Math.floor((bubbleW - emojiW) / 2)
  const offsetY = Math.floor((bubbleH - emojiH) / 2) - 1 // slightly above center

  for (let r = 0; r < emojiH; r++) {
    const destR = r + offsetY
    if (destR < 0 || destR >= bubbleH) continue
    for (let c = 0; c < emojiW; c++) {
      const destC = c + offsetX
      if (destC < 0 || destC >= bubbleW) continue
      const pixel = emoji[r][c]
      if (pixel) {
        result[destR][destC] = pixel
      }
    }
  }

  return result
}
