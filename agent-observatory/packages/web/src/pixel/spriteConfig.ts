/**
 * Per-kind character size configuration.
 *
 * Different character types (cat/cow/chicken) have different sprite sizes
 * and need adjusted constants for hit detection, bubble placement, etc.
 */

export type CharacterKind = 'cat' | 'cow' | 'chicken'

export interface CharacterSizeConfig {
  /** Half-width of the click hit box (px) */
  hitHalfWidth: number
  /** Height of the click hit box (px) */
  hitHeight: number
  /** Vertical offset for speech bubbles above head (px) */
  bubbleVerticalOffset: number
  /** Sitting offset when working at a crop patch (px) */
  sittingOffset: number
  /** Sitting offset for bubbles (slightly more than sittingOffset) */
  bubbleSittingOffset: number
  /** Expected sprite columns for matrix effect */
  matrixCols: number
  /** Expected sprite rows for matrix effect */
  matrixRows: number
}

const CAT_CONFIG: CharacterSizeConfig = {
  hitHalfWidth: 12,
  hitHeight: 36,
  bubbleVerticalOffset: 52,
  sittingOffset: 8,
  bubbleSittingOffset: 14,
  matrixCols: 48,
  matrixRows: 48,
}

const COW_CONFIG: CharacterSizeConfig = {
  hitHalfWidth: 14,
  hitHeight: 28,
  bubbleVerticalOffset: 36,
  sittingOffset: 6,
  bubbleSittingOffset: 10,
  matrixCols: 32,
  matrixRows: 32,
}

const CHICKEN_CONFIG: CharacterSizeConfig = {
  hitHalfWidth: 6,
  hitHeight: 14,
  bubbleVerticalOffset: 20,
  sittingOffset: 4,
  bubbleSittingOffset: 6,
  matrixCols: 16,
  matrixRows: 16,
}

/** Hardcoded 16×24 human character (legacy fallback) */
const LEGACY_CONFIG: CharacterSizeConfig = {
  hitHalfWidth: 8,
  hitHeight: 24,
  bubbleVerticalOffset: 24,
  sittingOffset: 6,
  bubbleSittingOffset: 10,
  matrixCols: 16,
  matrixRows: 24,
}

export function getCharSizeConfig(kind: CharacterKind | undefined): CharacterSizeConfig {
  switch (kind) {
    case 'cat': return CAT_CONFIG
    case 'cow': return COW_CONFIG
    case 'chicken': return CHICKEN_CONFIG
    default: return LEGACY_CONFIG
  }
}
