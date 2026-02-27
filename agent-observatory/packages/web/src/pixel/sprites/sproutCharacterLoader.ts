/**
 * Sprout Lands character sprite loader.
 *
 * Loads cat (48×48), cow (32×32), chicken (16×16) spritesheets
 * and converts them to LoadedCharacterData format for spriteData.ts.
 *
 * Cat spritesheet (192×192, 4×4 grid of 48×48):
 *   Row 0: Walk DOWN  ×4 frames
 *   Row 1: Walk UP    ×4 frames
 *   Row 2: Walk LEFT  ×4 frames
 *   Row 3: Walk RIGHT ×4 frames
 *
 * Cat actions (96×576, 2×12 grid of 48×48):
 *   Each pair of rows = one action animation (2 frames per direction)
 *   We use rows for farming action animations.
 *
 * Cow sprites (96×64, 3×2 grid of 32×32):
 *   Row 0: Walk DOWN ×3 frames
 *   Row 1: Walk LEFT ×3 frames  (flip for RIGHT)
 *
 * Chicken sprites (64×32, 4×2 grid of 16×16):
 *   Row 0: Walk DOWN ×4 frames
 *   Row 1: Walk LEFT ×4 frames  (flip for RIGHT)
 */

import type { SpriteData } from '../types'
import type { LoadedCharacterData } from './spriteData'
import { loadImage, sliceSpriteSheet, desaturateSprite } from './spriteSheetLoader'

const CAT_SHEET_URL = '/sprites/sprout/characters/cat-spritesheet.png'
const CAT_ACTIONS_URL = '/sprites/sprout/characters/cat-actions.png'
const COW_URL = '/sprites/sprout/characters/cow-sprites.png'
const CHICKEN_URL = '/sprites/sprout/characters/chicken-sprites.png'

function flipHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse())
}

/**
 * Load cat character (48×48 frames).
 * Returns LoadedCharacterData[] with one entry (desaturated for hue-shift).
 */
export async function loadCatSprites(): Promise<LoadedCharacterData[]> {
  const [sheetImg, actionsImg] = await Promise.all([
    loadImage(CAT_SHEET_URL),
    loadImage(CAT_ACTIONS_URL),
  ])

  // Walk frames: 4×4 grid
  const walkFrames = sliceSpriteSheet(sheetImg, 48, 48, 4, 4)
  // walkFrames indices: row*4+col
  // Row 0 (DOWN): [0,1,2,3], Row 1 (UP): [4,5,6,7], Row 2 (LEFT): [8,9,10,11], Row 3 (RIGHT): [12,13,14,15]

  // Action frames: 2×12 grid
  const actionFrames = sliceSpriteSheet(actionsImg, 48, 48, 2, 12)
  // actionFrames indices: row*2+col
  // Row 0-1: action 1 (till), Row 2-3: action 2 (water), etc.

  // For typing/working animation, use action rows 0-1 (first action, 2 cols × 2 rows = 4 frames)
  // We pick 2 frames for typing (down direction primary)
  const typingDown = [actionFrames[0], actionFrames[1]]  // row 0 col 0,1
  const typingUp = [actionFrames[2], actionFrames[3]]    // row 1 col 0,1
  const typingRight = [actionFrames[4], actionFrames[5]]  // row 2 col 0,1
  const typingLeft = typingRight.map(flipHorizontal)

  // Reading animation: use action rows 2-3 (second action)
  const readingDown = [actionFrames[4], actionFrames[5]]  // row 2 col 0,1
  const readingUp = [actionFrames[6], actionFrames[7]]    // row 3 col 0,1
  const readingRight = [actionFrames[8], actionFrames[9]]  // row 4 col 0,1
  const readingLeft = readingRight.map(flipHorizontal)

  // Build LoadedCharacterData format:
  // down: [walk1, walk2, walk3, walk4, type1, type2, read1, read2] (for backward compat we use 4 walk frames)
  // The existing system expects: down/up/right each with 7 frames [walk1,walk2,walk3,type1,type2,read1,read2]
  // But we have 4 walk frames. We'll use frame indices: [walk0,walk1,walk2,walk3, type0,type1, read0,read1]
  // Actually, looking at spriteData.ts: each direction has indices [0..N], parsed as:
  //   walk = [0,1,2] (3 frames) + type = [3,4] (2 frames) + read = [5,6] (2 frames)
  // So we provide 7 frames per direction but with 4 walk frames we adapt:
  // walk1 = static, walk2-4 = animation cycle, but the old system uses 3-frame walk.
  // Let's provide: [walk0, walk1, walk2, type0, type1, read0, read1] — skip walk3

  const desatWalk = walkFrames.map(desaturateSprite)
  const desatTypeD = typingDown.map(desaturateSprite)
  const desatTypeU = typingUp.map(desaturateSprite)
  const desatTypeR = typingRight.map(desaturateSprite)
  const desatTypeL = typingLeft.map(desaturateSprite)
  const desatReadD = readingDown.map(desaturateSprite)
  const desatReadU = readingUp.map(desaturateSprite)
  const desatReadR = readingRight.map(desaturateSprite)
  const desatReadL = readingLeft.map(desaturateSprite)

  const data: LoadedCharacterData = {
    down: [desatWalk[0], desatWalk[1], desatWalk[2], desatTypeD[0], desatTypeD[1], desatReadD[0], desatReadD[1]],
    up: [desatWalk[4], desatWalk[5], desatWalk[6], desatTypeU[0], desatTypeU[1], desatReadU[0], desatReadU[1]],
    right: [desatWalk[12], desatWalk[13], desatWalk[14], desatTypeR[0], desatTypeR[1], desatReadR[0], desatReadR[1]],
    left: [desatWalk[8], desatWalk[9], desatWalk[10], desatTypeL[0], desatTypeL[1], desatReadL[0], desatReadL[1]],
  }

  return [data]
}

/**
 * Load cow character (32×32 frames).
 * Cow only has walk animations; typing/reading reuse walk frames.
 */
export async function loadCowSprites(): Promise<LoadedCharacterData[]> {
  const img = await loadImage(COW_URL)
  // 3×2 grid of 32×32
  const frames = sliceSpriteSheet(img, 32, 32, 3, 2)
  // Row 0 (DOWN): [0,1,2], Row 1 (LEFT): [3,4,5]
  const desatFrames = frames.map(desaturateSprite)

  const rightFrames = desatFrames.slice(3, 6).map(flipHorizontal)

  const data: LoadedCharacterData = {
    down: [desatFrames[0], desatFrames[1], desatFrames[2], desatFrames[0], desatFrames[1], desatFrames[0], desatFrames[1]],
    up: [desatFrames[0], desatFrames[1], desatFrames[2], desatFrames[0], desatFrames[1], desatFrames[0], desatFrames[1]],
    right: [rightFrames[0], rightFrames[1], rightFrames[2], rightFrames[0], rightFrames[1], rightFrames[0], rightFrames[1]],
    left: [desatFrames[3], desatFrames[4], desatFrames[5], desatFrames[3], desatFrames[4], desatFrames[3], desatFrames[4]],
  }

  return [data]
}

/**
 * Load chicken character (16×16 frames).
 * Chicken only has walk animations.
 */
export async function loadChickenSprites(): Promise<LoadedCharacterData[]> {
  const img = await loadImage(CHICKEN_URL)
  // 4×2 grid of 16×16
  const frames = sliceSpriteSheet(img, 16, 16, 4, 2)
  // Row 0 (DOWN): [0,1,2,3], Row 1 (LEFT): [4,5,6,7]
  const desatFrames = frames.map(desaturateSprite)

  const rightFrames = desatFrames.slice(4, 8).map(flipHorizontal)

  const data: LoadedCharacterData = {
    down: [desatFrames[0], desatFrames[1], desatFrames[2], desatFrames[0], desatFrames[1], desatFrames[0], desatFrames[1]],
    up: [desatFrames[0], desatFrames[1], desatFrames[2], desatFrames[0], desatFrames[1], desatFrames[0], desatFrames[1]],
    right: [rightFrames[0], rightFrames[1], rightFrames[2], rightFrames[0], rightFrames[1], rightFrames[0], rightFrames[1]],
    left: [desatFrames[4], desatFrames[5], desatFrames[6], desatFrames[4], desatFrames[5], desatFrames[4], desatFrames[5]],
  }

  return [data]
}
