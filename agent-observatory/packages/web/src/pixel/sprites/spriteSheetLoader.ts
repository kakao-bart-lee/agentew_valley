/**
 * Spritesheet loader utilities — loads PNG images and extracts SpriteData.
 *
 * Uses offscreen canvas + getImageData to convert PNG pixels into the
 * existing SpriteData format (2D string[][] of '#RRGGBB' hex or '' for transparent).
 */

import type { SpriteData } from '../types'

/** Load an image from a URL. Resolves when fully decoded. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

/**
 * Extract a rectangular region from an image and convert to SpriteData.
 * Transparent pixels (alpha < 128) become '' (empty string).
 */
export function extractRegionToSpriteData(
  img: HTMLImageElement | HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): SpriteData {
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  const imageData = ctx.getImageData(0, 0, sw, sh)
  return imageDataToSpriteData(imageData, sw, sh)
}

/**
 * Slice a spritesheet into an array of SpriteData frames.
 * Slices left-to-right, top-to-bottom.
 * If cols/rows not specified, infers from image dimensions.
 */
export function sliceSpriteSheet(
  img: HTMLImageElement,
  frameW: number,
  frameH: number,
  cols?: number,
  rows?: number,
): SpriteData[] {
  const actualCols = cols ?? Math.floor(img.width / frameW)
  const actualRows = rows ?? Math.floor(img.height / frameH)
  const frames: SpriteData[] = []
  for (let r = 0; r < actualRows; r++) {
    for (let c = 0; c < actualCols; c++) {
      frames.push(extractRegionToSpriteData(img, c * frameW, r * frameH, frameW, frameH))
    }
  }
  return frames
}

/**
 * Convert SpriteData to desaturated (grayscale) version.
 * Preserves transparent pixels. Compatible with the colorize pipeline.
 */
export function desaturateSprite(sprite: SpriteData): SpriteData {
  return sprite.map((row) =>
    row.map((pixel) => {
      if (!pixel) return ''
      const { r, g, b } = hexToRgb(pixel)
      // ITU-R BT.601 luma
      const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114)
      return rgbToHex(gray, gray, gray)
    }),
  )
}

// ── Internal helpers ──────────────────────────────────────────────

function imageDataToSpriteData(data: ImageData, w: number, h: number): SpriteData {
  const result: SpriteData = []
  for (let y = 0; y < h; y++) {
    const row: string[] = []
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const r = data.data[idx]
      const g = data.data[idx + 1]
      const b = data.data[idx + 2]
      const a = data.data[idx + 3]
      if (a < 128) {
        row.push('')
      } else {
        row.push(rgbToHex(r, g, b))
      }
    }
    result.push(row)
  }
  return result
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
