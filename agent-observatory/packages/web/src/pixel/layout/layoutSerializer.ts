import { TileType, DEFAULT_COLS, DEFAULT_ROWS, TILE_SIZE, Direction } from '../types'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, Seat, FurnitureInstance, FloorColor } from '../types'
import { getCatalogEntry } from './furnitureCatalog'
import { getColorizedSprite } from '../colorize'

/** Convert flat tile array from layout into 2D grid */
export function layoutToTileMap(layout: OfficeLayout): TileTypeVal[][] {
  const map: TileTypeVal[][] = []
  for (let r = 0; r < layout.rows; r++) {
    const row: TileTypeVal[] = []
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c])
    }
    map.push(row)
  }
  return map
}

/** Convert placed furniture into renderable FurnitureInstance[] */
export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  // Pre-compute desk zY per tile so surface items can sort in front of desks
  const deskZByTile = new Map<string, number>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    const deskZY = item.row * TILE_SIZE + entry.sprite.length
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        const prev = deskZByTile.get(key)
        if (prev === undefined || deskZY > prev) deskZByTile.set(key, deskZY)
      }
    }
  }

  const instances: FurnitureInstance[] = []
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const x = item.col * TILE_SIZE
    const y = item.row * TILE_SIZE
    const spriteH = entry.sprite.length
    let zY = y + spriteH

    // Chair z-sorting: ensure characters sitting on chairs render correctly
    if (entry.category === 'chairs') {
      if (entry.orientation === 'back') {
        // Back-facing chairs render IN FRONT of the seated character
        // (the chair back visually occludes the character behind it)
        zY = (item.row + 1) * TILE_SIZE + 1
      } else {
        // All other chairs: cap zY to first row bottom so characters
        // at any seat tile render in front of the chair
        zY = (item.row + 1) * TILE_SIZE
      }
    }

    // Surface items render in front of the desk they sit on
    if (entry.canPlaceOnSurfaces) {
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          const deskZ = deskZByTile.get(`${item.col + dc},${item.row + dr}`)
          if (deskZ !== undefined && deskZ + 0.5 > zY) zY = deskZ + 0.5
        }
      }
    }

    // Colorize sprite if this furniture has a color override
    let sprite = entry.sprite
    if (item.color) {
      const { h, s, b: bv, c: cv } = item.color
      sprite = getColorizedSprite(`furn-${item.type}-${h}-${s}-${bv}-${cv}-${item.color.colorize ? 1 : 0}`, entry.sprite, item.color)
    }

    instances.push({ sprite, x, y, zY })
  }
  return instances
}

/** Get all tiles blocked by furniture footprints, optionally excluding a set of tiles.
 *  Skips top backgroundTiles rows so characters can walk through them. */
export function getBlockedTiles(furniture: PlacedFurniture[], excludeTiles?: Set<string>): Set<string> {
  const tiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const bgRows = entry.backgroundTiles || 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue // skip background rows — characters can walk through
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        if (excludeTiles && excludeTiles.has(key)) continue
        tiles.add(key)
      }
    }
  }
  return tiles
}

/** Get tiles blocked for placement purposes — skips top backgroundTiles rows per item */
export function getPlacementBlockedTiles(furniture: PlacedFurniture[], excludeUid?: string): Set<string> {
  const tiles = new Set<string>()
  for (const item of furniture) {
    if (item.uid === excludeUid) continue
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const bgRows = entry.backgroundTiles || 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue // skip background rows
      for (let dc = 0; dc < entry.footprintW; dc++) {
        tiles.add(`${item.col + dc},${item.row + dr}`)
      }
    }
  }
  return tiles
}

/** Map chair orientation to character facing direction */
function orientationToFacing(orientation: string): Direction {
  switch (orientation) {
    case 'front': return Direction.DOWN
    case 'back': return Direction.UP
    case 'left': return Direction.LEFT
    case 'right': return Direction.RIGHT
    default: return Direction.DOWN
  }
}

/** Generate seats from chair furniture.
 *  Facing priority: 1) chair orientation, 2) adjacent desk, 3) forward (DOWN). */
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>()

  // Build set of all desk tiles
  const deskTiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`)
      }
    }
  }

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP },    // desk is above chair → face UP
    { dc: 0, dr: 1, facing: Direction.DOWN },   // desk is below chair → face DOWN
    { dc: -1, dr: 0, facing: Direction.LEFT },   // desk is left of chair → face LEFT
    { dc: 1, dr: 0, facing: Direction.RIGHT },   // desk is right of chair → face RIGHT
  ]

  // For each chair, every footprint tile becomes a seat.
  // Multi-tile chairs (e.g. 2-tile couches) produce multiple seats.
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || entry.category !== 'chairs') continue

    let seatCount = 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const tileCol = item.col + dc
        const tileRow = item.row + dr

        // Determine facing direction:
        // 1) Chair orientation takes priority
        // 2) Adjacent desk direction
        // 3) Default forward (DOWN)
        let facingDir: Direction = Direction.DOWN
        if (entry.orientation) {
          facingDir = orientationToFacing(entry.orientation)
        } else {
          for (const d of dirs) {
            if (deskTiles.has(`${tileCol + d.dc},${tileRow + d.dr}`)) {
              facingDir = d.facing
              break
            }
          }
        }

        // First seat uses chair uid (backward compat), subsequent use uid:N
        const seatUid = seatCount === 0 ? item.uid : `${item.uid}:${seatCount}`
        seats.set(seatUid, {
          uid: seatUid,
          seatCol: tileCol,
          seatRow: tileRow,
          facingDir,
          assigned: false,
        })
        seatCount++
      }
    }
  }

  return seats
}

/** Get the set of tiles occupied by seats (so they can be excluded from blocked tiles) */
export function getSeatTiles(seats: Map<string, Seat>): Set<string> {
  const tiles = new Set<string>()
  for (const seat of seats.values()) {
    tiles.add(`${seat.seatCol},${seat.seatRow}`)
  }
  return tiles
}

/** Default floor colors — neutral preserves original Sprout Lands PNG colors */
const NEUTRAL_COLOR: FloorColor = { h: 0, s: 0, b: 0, c: 0 }

/** Create the default 4-quadrant farm layout (40×28) */
export function createDefaultLayout(): OfficeLayout {
  const W = TileType.WALL
  const F1 = TileType.FLOOR_1  // grass
  const F2 = TileType.FLOOR_2  // dirt path
  const F3 = TileType.FLOOR_3  // dark grass (crop beds)

  const COLS = DEFAULT_COLS  // 40
  const ROWS = DEFAULT_ROWS  // 28

  const tiles: TileTypeVal[] = []
  const tileColors: Array<FloorColor | null> = []

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Fence border (row 0/27, col 0/39)
      if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) {
        tiles.push(W); tileColors.push(NEUTRAL_COLOR); continue
      }
      // Cross path: vertical cols 19-20, horizontal rows 13-14
      if ((c === 19 || c === 20) || (r === 13 || r === 14)) {
        tiles.push(F2); tileColors.push(NEUTRAL_COLOR); continue
      }
      // Q1 crop bed: cols 4-9, rows 4-7
      if (c >= 4 && c <= 9 && r >= 4 && r <= 7) {
        tiles.push(F3); tileColors.push(NEUTRAL_COLOR); continue
      }
      // Q2 crop bed: cols 25-30, rows 4-7
      if (c >= 25 && c <= 30 && r >= 4 && r <= 7) {
        tiles.push(F3); tileColors.push(NEUTRAL_COLOR); continue
      }
      // Q3 crop bed: cols 4-9, rows 19-22
      if (c >= 4 && c <= 9 && r >= 19 && r <= 22) {
        tiles.push(F3); tileColors.push(NEUTRAL_COLOR); continue
      }
      // Q4 crop bed: cols 25-30, rows 19-22
      if (c >= 25 && c <= 30 && r >= 19 && r <= 22) {
        tiles.push(F3); tileColors.push(NEUTRAL_COLOR); continue
      }
      // Default grass
      tiles.push(F1); tileColors.push(NEUTRAL_COLOR)
    }
  }

  const furniture: PlacedFurniture[] = [
    // ════════════════════════════════════════════════════════
    // Q1 (NW) — 과수원: oak/apple trees, wheat/carrot crops
    // ════════════════════════════════════════════════════════

    // Trees
    { uid: 'q1-tree-1', type: 'tree-oak-tree', col: 1, row: 1 },
    { uid: 'q1-tree-2', type: 'tree-apple-tree', col: 15, row: 1 },
    { uid: 'q1-tree-3', type: 'tree-oak-tree', col: 1, row: 9 },
    { uid: 'q1-tree-4', type: 'tree-apple-tree', col: 10, row: 9 },
    // Bushes
    { uid: 'q1-bush-1', type: 'tree-bush', col: 8, row: 1 },
    { uid: 'q1-bush-2', type: 'tree-berry-bush', col: 16, row: 10 },
    // Crops (isDesk, staggered)
    { uid: 'q1-crop-1', type: 'crop-wheat', col: 4, row: 4 },
    { uid: 'q1-crop-2', type: 'crop-carrot', col: 6, row: 4 },
    { uid: 'q1-crop-3', type: 'crop-wheat', col: 8, row: 4 },
    { uid: 'q1-crop-4', type: 'crop-carrot', col: 5, row: 5 },
    { uid: 'q1-crop-5', type: 'crop-wheat', col: 7, row: 5 },
    { uid: 'q1-crop-6', type: 'crop-carrot', col: 9, row: 5 },
    // Work spots (chairs below crops)
    { uid: 'q1-spot-1', type: 'chair', col: 4, row: 6 },
    { uid: 'q1-spot-2', type: 'chair', col: 6, row: 6 },
    { uid: 'q1-spot-3', type: 'chair', col: 8, row: 6 },
    { uid: 'q1-spot-4', type: 'chair', col: 5, row: 7 },
    { uid: 'q1-spot-5', type: 'chair', col: 7, row: 7 },
    { uid: 'q1-spot-6', type: 'chair', col: 9, row: 7 },
    // Nature decor
    { uid: 'q1-flower-1', type: 'nature-flower-red', col: 3, row: 2 },
    { uid: 'q1-flower-2', type: 'nature-flower-yellow', col: 12, row: 3 },
    { uid: 'q1-grass-1', type: 'nature-grass-tuft', col: 14, row: 6 },
    { uid: 'q1-grass-2', type: 'nature-grass-tuft', col: 11, row: 2 },
    { uid: 'q1-mushroom-1', type: 'nature-mushroom', col: 17, row: 8 },
    // Stone
    { uid: 'q1-stone-1', type: 'nature-stone-small', col: 13, row: 11 },
    // Storage
    { uid: 'q1-barrel-1', type: 'misc-barrel', col: 17, row: 11 },

    // ════════════════════════════════════════════════════════
    // Q2 (NE) — 소나무숲: pine trees, corn/sunflower crops
    // ════════════════════════════════════════════════════════

    // Trees
    { uid: 'q2-tree-1', type: 'tree-pine-tree', col: 22, row: 1 },
    { uid: 'q2-tree-2', type: 'tree-pine-tree', col: 36, row: 1 },
    { uid: 'q2-tree-3', type: 'tree-pine-tree', col: 22, row: 9 },
    { uid: 'q2-tree-4', type: 'tree-pine-tree', col: 35, row: 9 },
    // Bushes
    { uid: 'q2-bush-1', type: 'tree-bush', col: 32, row: 1 },
    { uid: 'q2-bush-2', type: 'tree-berry-bush', col: 24, row: 10 },
    // Crops (staggered)
    { uid: 'q2-crop-1', type: 'crop-corn', col: 25, row: 4 },
    { uid: 'q2-crop-2', type: 'crop-sunflower', col: 27, row: 4 },
    { uid: 'q2-crop-3', type: 'crop-corn', col: 29, row: 4 },
    { uid: 'q2-crop-4', type: 'crop-sunflower', col: 26, row: 5 },
    { uid: 'q2-crop-5', type: 'crop-corn', col: 28, row: 5 },
    { uid: 'q2-crop-6', type: 'crop-sunflower', col: 30, row: 5 },
    // Work spots
    { uid: 'q2-spot-1', type: 'chair', col: 25, row: 6 },
    { uid: 'q2-spot-2', type: 'chair', col: 27, row: 6 },
    { uid: 'q2-spot-3', type: 'chair', col: 29, row: 6 },
    { uid: 'q2-spot-4', type: 'chair', col: 26, row: 7 },
    { uid: 'q2-spot-5', type: 'chair', col: 28, row: 7 },
    { uid: 'q2-spot-6', type: 'chair', col: 30, row: 7 },
    // Nature decor
    { uid: 'q2-flower-1', type: 'nature-flower-blue', col: 33, row: 3 },
    { uid: 'q2-flower-2', type: 'nature-flower-red', col: 24, row: 2 },
    { uid: 'q2-grass-1', type: 'nature-grass-tuft', col: 31, row: 10 },
    { uid: 'q2-grass-2', type: 'nature-grass-tuft', col: 37, row: 5 },
    { uid: 'q2-mushroom-1', type: 'nature-mushroom', col: 34, row: 11 },
    // Stone
    { uid: 'q2-stone-1', type: 'nature-rock-pile', col: 37, row: 8 },
    // Storage
    { uid: 'q2-chest-1', type: 'misc-chest', col: 37, row: 11 },

    // ════════════════════════════════════════════════════════
    // Q3 (SW) — 베리 농장: apple tree/berry bush, turnip/pumpkin
    // ════════════════════════════════════════════════════════

    // Trees
    { uid: 'q3-tree-1', type: 'tree-apple-tree', col: 1, row: 16 },
    { uid: 'q3-tree-2', type: 'tree-oak-tree', col: 15, row: 16 },
    { uid: 'q3-tree-3', type: 'tree-apple-tree', col: 1, row: 24 },
    { uid: 'q3-tree-4', type: 'tree-oak-tree', col: 10, row: 24 },
    // Bushes
    { uid: 'q3-bush-1', type: 'tree-berry-bush', col: 8, row: 16 },
    { uid: 'q3-bush-2', type: 'tree-berry-bush', col: 16, row: 24 },
    // Crops (staggered)
    { uid: 'q3-crop-1', type: 'crop-turnip', col: 4, row: 19 },
    { uid: 'q3-crop-2', type: 'crop-pumpkin', col: 6, row: 19 },
    { uid: 'q3-crop-3', type: 'crop-turnip', col: 8, row: 19 },
    { uid: 'q3-crop-4', type: 'crop-pumpkin', col: 5, row: 20 },
    { uid: 'q3-crop-5', type: 'crop-turnip', col: 7, row: 20 },
    { uid: 'q3-crop-6', type: 'crop-pumpkin', col: 9, row: 20 },
    // Work spots
    { uid: 'q3-spot-1', type: 'chair', col: 4, row: 21 },
    { uid: 'q3-spot-2', type: 'chair', col: 6, row: 21 },
    { uid: 'q3-spot-3', type: 'chair', col: 8, row: 21 },
    { uid: 'q3-spot-4', type: 'chair', col: 5, row: 22 },
    { uid: 'q3-spot-5', type: 'chair', col: 7, row: 22 },
    { uid: 'q3-spot-6', type: 'chair', col: 9, row: 22 },
    // Nature decor
    { uid: 'q3-flower-1', type: 'nature-flower-yellow', col: 3, row: 17 },
    { uid: 'q3-flower-2', type: 'nature-flower-red', col: 12, row: 18 },
    { uid: 'q3-grass-1', type: 'nature-grass-tuft', col: 14, row: 23 },
    { uid: 'q3-grass-2', type: 'nature-grass-tuft', col: 11, row: 17 },
    { uid: 'q3-mushroom-1', type: 'nature-mushroom', col: 3, row: 25 },
    // Stone
    { uid: 'q3-stone-1', type: 'nature-stone-large', col: 13, row: 25 },
    // Storage
    { uid: 'q3-barrel-1', type: 'misc-barrel', col: 17, row: 25 },
    { uid: 'q3-chest-1', type: 'misc-chest', col: 16, row: 25 },

    // ════════════════════════════════════════════════════════
    // Q4 (SE) — 꽃밭: mixed trees, wheat/corn + flowers
    // ════════════════════════════════════════════════════════

    // Trees
    { uid: 'q4-tree-1', type: 'tree-oak-tree', col: 22, row: 16 },
    { uid: 'q4-tree-2', type: 'tree-apple-tree', col: 36, row: 16 },
    { uid: 'q4-tree-3', type: 'tree-pine-tree', col: 22, row: 24 },
    { uid: 'q4-tree-4', type: 'tree-oak-tree', col: 35, row: 24 },
    // Bushes
    { uid: 'q4-bush-1', type: 'tree-bush', col: 32, row: 16 },
    { uid: 'q4-bush-2', type: 'tree-berry-bush', col: 24, row: 25 },
    // Crops (staggered)
    { uid: 'q4-crop-1', type: 'crop-wheat', col: 25, row: 19 },
    { uid: 'q4-crop-2', type: 'crop-corn', col: 27, row: 19 },
    { uid: 'q4-crop-3', type: 'crop-wheat', col: 29, row: 19 },
    { uid: 'q4-crop-4', type: 'crop-corn', col: 26, row: 20 },
    { uid: 'q4-crop-5', type: 'crop-wheat', col: 28, row: 20 },
    { uid: 'q4-crop-6', type: 'crop-corn', col: 30, row: 20 },
    // Work spots
    { uid: 'q4-spot-1', type: 'chair', col: 25, row: 21 },
    { uid: 'q4-spot-2', type: 'chair', col: 27, row: 21 },
    { uid: 'q4-spot-3', type: 'chair', col: 29, row: 21 },
    { uid: 'q4-spot-4', type: 'chair', col: 26, row: 22 },
    { uid: 'q4-spot-5', type: 'chair', col: 28, row: 22 },
    { uid: 'q4-spot-6', type: 'chair', col: 30, row: 22 },
    // Extra flowers (Q4 is the flower quadrant)
    { uid: 'q4-flower-1', type: 'nature-flower-blue', col: 33, row: 18 },
    { uid: 'q4-flower-2', type: 'nature-flower-red', col: 34, row: 20 },
    { uid: 'q4-flower-3', type: 'nature-flower-yellow', col: 24, row: 17 },
    { uid: 'q4-flower-4', type: 'nature-flower-blue', col: 31, row: 23 },
    { uid: 'q4-flower-5', type: 'nature-flower-red', col: 37, row: 17 },
    { uid: 'q4-grass-1', type: 'nature-grass-tuft', col: 33, row: 25 },
    { uid: 'q4-grass-2', type: 'nature-grass-tuft', col: 37, row: 22 },
    // Stone
    { uid: 'q4-stone-1', type: 'nature-stone-small', col: 36, row: 25 },
    // Storage
    { uid: 'q4-barrel-1', type: 'misc-barrel', col: 37, row: 25 },

    // ════════════════════════════════════════════════════════
    // Center crossroads decoration (cols 19-20, rows 13-14)
    // ════════════════════════════════════════════════════════
    { uid: 'center-flower-1', type: 'nature-flower-red', col: 18, row: 12 },
    { uid: 'center-flower-2', type: 'nature-flower-blue', col: 21, row: 12 },
    { uid: 'center-flower-3', type: 'nature-flower-yellow', col: 18, row: 15 },
    { uid: 'center-flower-4', type: 'nature-flower-red', col: 21, row: 15 },

    // Signpost near center
    { uid: 'center-stump', type: 'tree-stump', col: 17, row: 12 },
  ]

  return { version: 1, cols: COLS, rows: ROWS, tiles, tileColors, furniture }
}

/** Serialize layout to JSON string */
export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout)
}

/** Deserialize layout from JSON string, migrating old tile types if needed */
export function deserializeLayout(json: string): OfficeLayout | null {
  try {
    const obj = JSON.parse(json)
    if (obj && obj.version === 1 && Array.isArray(obj.tiles) && Array.isArray(obj.furniture)) {
      return migrateLayout(obj as OfficeLayout)
    }
  } catch { /* ignore parse errors */ }
  return null
}

/**
 * Ensure layout has tileColors. If missing, generate defaults based on tile types.
 * Exported for use by message handlers that receive layouts over the wire.
 */
export function migrateLayoutColors(layout: OfficeLayout): OfficeLayout {
  return migrateLayout(layout)
}

/**
 * Migrate old layouts that use legacy tile types (TILE_FLOOR=1, WOOD_FLOOR=2, CARPET=3, DOORWAY=4)
 * to the new pattern-based system. If tileColors is already present, no migration needed.
 */
function migrateLayout(layout: OfficeLayout): OfficeLayout {
  if (layout.tileColors && layout.tileColors.length === layout.tiles.length) {
    return layout // Already migrated
  }

  // Check if any tiles use old values (1-4) — these map directly to FLOOR_1-4
  // but need color assignments
  const tileColors: Array<FloorColor | null> = []
  for (const tile of layout.tiles) {
    switch (tile) {
      case 0: // WALL (fence) — neutral preserves original fence sprite colors
        tileColors.push(NEUTRAL_COLOR)
        break
      case 1: // FLOOR_1 → grass
        tileColors.push(NEUTRAL_COLOR)
        break
      case 2: // FLOOR_2 → dirt path
        tileColors.push(NEUTRAL_COLOR)
        break
      case 3: // FLOOR_3 → dark grass
        tileColors.push(NEUTRAL_COLOR)
        break
      case 4: // FLOOR_4 → dirt (legacy doorway)
        tileColors.push(NEUTRAL_COLOR)
        break
      default:
        // New tile types (5-7) without colors — use neutral gray
        tileColors.push(tile > 0 ? { h: 0, s: 0, b: 0, c: 0 } : null)
    }
  }

  return { ...layout, tileColors }
}
