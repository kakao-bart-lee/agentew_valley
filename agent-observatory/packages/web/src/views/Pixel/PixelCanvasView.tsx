/**
 * PixelCanvasView - 픽셀 사무실 에이전트 시각화 뷰
 *
 * agentStore의 에이전트 상태를 구독하여 Canvas 2D로 렌더링.
 * 레이아웃은 localStorage에 저장/복원.
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { OfficeState } from '../../pixel/engine/officeState'
import { EditorState } from '../../pixel/editor/editorState'
import { EditorToolbar } from '../../pixel/editor/EditorToolbar'
import { PixelOfficeCanvas } from '../../pixel/components/PixelOfficeCanvas'
import { useAgentBridge } from '../../pixel/hooks/useAgentBridge'
import { createDefaultLayout, serializeLayout, deserializeLayout } from '../../pixel/layout/layoutSerializer'
import { moveFurniture, rotateFurniture, removeFurniture, paintTile, placeFurniture, expandLayout } from '../../pixel/editor/editorActions'
import { defaultZoom } from '../../pixel/toolUtils'
import { EditTool, TileType } from '../../pixel/types'
import type { OfficeLayout, FloorColor } from '../../pixel/types'
import { LAYOUT_SAVE_DEBOUNCE_MS } from '../../pixel/constants'
import { loadAllSproutAssets } from '../../pixel/sprites/sproutAssetLoader'

const LAYOUT_STORAGE_KEY = 'pixel-office-layout'

function loadSavedLayout(): OfficeLayout | null {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (saved) return deserializeLayout(saved)
  } catch {
    // ignore
  }
  return null
}

function saveLayout(layout: OfficeLayout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout))
  } catch {
    // ignore
  }
}

export function PixelCanvasView() {
  // OfficeState: 레이아웃 로드 후 초기화
  const officeStateRef = useRef<OfficeState | null>(null)
  if (!officeStateRef.current) {
    const savedLayout = loadSavedLayout()
    officeStateRef.current = new OfficeState(savedLayout ?? createDefaultLayout())
  }

  const editorStateRef = useRef<EditorState>(new EditorState())
  const panRef = useRef({ x: 0, y: 0 })

  const [zoom, setZoom] = useState(() => defaultZoom())
  const [isEditMode, setIsEditMode] = useState(false)
  const [editorTick, setEditorTick] = useState(0)

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sprout 에셋 로딩 (마운트 시 1회) — 로드 후 furniture 재빌드
  useEffect(() => {
    loadAllSproutAssets().then((result) => {
      const s = Object.values(result).filter(Boolean).length
      const t = Object.keys(result).length
      console.log(`Sprout assets: ${s}/${t} loaded`)
      // Rebuild furniture instances now that dynamic catalog is available
      const office = officeStateRef.current
      if (office) {
        office.rebuildFromLayout(office.layout)
      }
    })
  }, [])

  // agentStore → OfficeState 브릿지
  const getOfficeState = useCallback(() => officeStateRef.current!, [])
  useAgentBridge(getOfficeState)

  // 레이아웃 변경 시 localStorage 저장 (디바운스)
  const handleLayoutChange = useCallback((layout: OfficeLayout) => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = setTimeout(() => {
      saveLayout(layout)
    }, LAYOUT_SAVE_DEBOUNCE_MS)
  }, [])

  // 에디터 틱 증가 → 재렌더
  const tickEditor = useCallback(() => {
    setEditorTick((t) => t + 1)
  }, [])

  // 타일/가구 페인트 액션
  const handleEditorTileAction = useCallback(
    (col: number, row: number) => {
      const officeState = officeStateRef.current!
      const editorState = editorStateRef.current
      const layout = officeState.getLayout()

      if (editorState.activeTool === EditTool.EYEDROPPER) {
        const idx = row * layout.cols + col
        const tileType = layout.tiles[idx]
        if (tileType !== undefined) {
          editorState.selectedTileType = tileType
          const tileColor = layout.tileColors?.[idx]
          if (tileColor) editorState.floorColor = { ...tileColor }
          editorState.activeTool = EditTool.TILE_PAINT
          tickEditor()
        }
        return
      }

      if (editorState.activeTool === EditTool.TILE_PAINT) {
        if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) {
          const dir = col < 0 ? 'left' : col >= layout.cols ? 'right' : row < 0 ? 'up' : 'down'
          const result = expandLayout(layout, dir as 'left' | 'right' | 'up' | 'down')
          if (result) {
            editorState.pushUndo(layout)
            editorState.clearRedo()
            officeState.rebuildFromLayout(result.layout, result.shift)
            handleLayoutChange(result.layout)
            tickEditor()
          }
          return
        }
        editorState.pushUndo(layout)
        editorState.clearRedo()
        const newLayout = paintTile(layout, col, row, editorState.selectedTileType, editorState.floorColor)
        officeState.rebuildFromLayout(newLayout)
        handleLayoutChange(newLayout)
        tickEditor()
        return
      }

      if (editorState.activeTool === EditTool.WALL_PAINT) {
        if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) {
          const dir = col < 0 ? 'left' : col >= layout.cols ? 'right' : row < 0 ? 'up' : 'down'
          const result = expandLayout(layout, dir as 'left' | 'right' | 'up' | 'down')
          if (result) {
            editorState.pushUndo(layout)
            editorState.clearRedo()
            officeState.rebuildFromLayout(result.layout, result.shift)
            handleLayoutChange(result.layout)
            tickEditor()
          }
          return
        }
        const idx = row * layout.cols + col
        const currentTile = layout.tiles[idx]
        if (editorState.wallDragAdding === null) {
          editorState.wallDragAdding = currentTile !== TileType.WALL
        }
        editorState.pushUndo(layout)
        editorState.clearRedo()
        const newTileType = editorState.wallDragAdding ? TileType.WALL : TileType.FLOOR_1
        const newLayout = paintTile(
          layout,
          col,
          row,
          newTileType,
          editorState.wallDragAdding ? editorState.wallColor : editorState.floorColor,
        )
        officeState.rebuildFromLayout(newLayout)
        handleLayoutChange(newLayout)
        tickEditor()
        return
      }

      if (editorState.activeTool === EditTool.ERASE) {
        if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) {
          const dir = col < 0 ? 'left' : col >= layout.cols ? 'right' : row < 0 ? 'up' : 'down'
          const result = expandLayout(layout, dir as 'left' | 'right' | 'up' | 'down')
          if (result) {
            editorState.pushUndo(layout)
            editorState.clearRedo()
            officeState.rebuildFromLayout(result.layout, result.shift)
            handleLayoutChange(result.layout)
            tickEditor()
          }
          return
        }
        editorState.pushUndo(layout)
        editorState.clearRedo()
        const newLayout = paintTile(layout, col, row, TileType.VOID)
        officeState.rebuildFromLayout(newLayout)
        handleLayoutChange(newLayout)
        tickEditor()
        return
      }

      if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
        if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return
        const uid = `furn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        editorState.pushUndo(layout)
        editorState.clearRedo()
        const newLayout = placeFurniture(layout, { uid, type: editorState.selectedFurnitureType, col, row })
        if (newLayout !== layout) {
          officeState.rebuildFromLayout(newLayout)
          handleLayoutChange(newLayout)
          tickEditor()
        }
      }
    },
    [handleLayoutChange, tickEditor],
  )

  // 타일 지우기 액션 (우클릭 드래그)
  const handleEditorEraseAction = useCallback((col: number, row: number) => {
    const officeState = officeStateRef.current!
    const editorState = editorStateRef.current
    const layout = officeState.getLayout()
    if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return
    editorState.pushUndo(layout)
    editorState.clearRedo()
    const newLayout = paintTile(layout, col, row, TileType.VOID)
    officeState.rebuildFromLayout(newLayout)
    handleLayoutChange(newLayout)
    tickEditor()
  }, [handleLayoutChange, tickEditor])

  // 선택 변경
  const handleEditorSelectionChange = useCallback(() => {
    tickEditor()
  }, [tickEditor])

  // 선택 가구 삭제
  const handleDeleteSelected = useCallback(() => {
    const officeState = officeStateRef.current!
    const editorState = editorStateRef.current
    if (!editorState.selectedFurnitureUid) return
    const layout = officeState.getLayout()
    editorState.pushUndo(layout)
    editorState.clearRedo()
    const newLayout = removeFurniture(layout, editorState.selectedFurnitureUid)
    editorState.clearSelection()
    officeState.rebuildFromLayout(newLayout)
    handleLayoutChange(newLayout)
    tickEditor()
  }, [handleLayoutChange, tickEditor])

  // 선택 가구 회전
  const handleRotateSelected = useCallback(() => {
    const officeState = officeStateRef.current!
    const editorState = editorStateRef.current
    if (!editorState.selectedFurnitureUid) return
    const layout = officeState.getLayout()
    editorState.pushUndo(layout)
    editorState.clearRedo()
    const newLayout = rotateFurniture(layout, editorState.selectedFurnitureUid, 'cw')
    officeState.rebuildFromLayout(newLayout)
    handleLayoutChange(newLayout)
    tickEditor()
  }, [handleLayoutChange, tickEditor])

  // 드래그로 가구 이동
  const handleDragMove = useCallback((uid: string, newCol: number, newRow: number) => {
    const officeState = officeStateRef.current!
    const editorState = editorStateRef.current
    const layout = officeState.getLayout()
    editorState.pushUndo(layout)
    editorState.clearRedo()
    const newLayout = moveFurniture(layout, uid, newCol, newRow)
    officeState.rebuildFromLayout(newLayout)
    handleLayoutChange(newLayout)
    tickEditor()
  }, [handleLayoutChange, tickEditor])

  // 키보드 단축키: Ctrl+Z / Ctrl+Shift+Z
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isEditMode) return
      const officeState = officeStateRef.current!
      const editorState = editorStateRef.current
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const prev = editorState.popUndo()
        if (prev) {
          editorState.pushRedo(officeState.getLayout())
          officeState.rebuildFromLayout(prev)
          handleLayoutChange(prev)
          tickEditor()
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        const next = editorState.popRedo()
        if (next) {
          editorState.pushUndo(officeState.getLayout())
          officeState.rebuildFromLayout(next)
          handleLayoutChange(next)
          tickEditor()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isEditMode, handleLayoutChange, tickEditor])

  // 선택된 가구의 현재 색상 가져오기
  const selectedFurnitureColor = (() => {
    const editorState = editorStateRef.current
    if (!editorState.selectedFurnitureUid) return null
    const layout = officeStateRef.current?.getLayout()
    if (!layout) return null
    const item = layout.furniture.find((f) => f.uid === editorState.selectedFurnitureUid)
    return item?.color ?? null
  })()

  const handleSelectedFurnitureColorChange = useCallback((color: FloorColor | null) => {
    const officeState = officeStateRef.current!
    const editorState = editorStateRef.current
    if (!editorState.selectedFurnitureUid) return
    const layout = officeState.getLayout()
    const newLayout = {
      ...layout,
      furniture: layout.furniture.map((f) =>
        f.uid === editorState.selectedFurnitureUid ? { ...f, color: color ?? undefined } : f,
      ),
    }
    officeState.rebuildFromLayout(newLayout)
    handleLayoutChange(newLayout)
    tickEditor()
  }, [handleLayoutChange, tickEditor])

  return (
    <div className="flex-1 w-full min-h-0 overflow-hidden bg-[#1E1E2E] flex flex-col relative">
      {/* 캔버스 영역 */}
      <div className="flex-1 relative min-h-0">
        <PixelOfficeCanvas
          officeState={officeStateRef.current}
          onClick={() => {}}
          isEditMode={isEditMode}
          editorState={editorStateRef.current}
          onEditorTileAction={handleEditorTileAction}
          onEditorEraseAction={handleEditorEraseAction}
          onEditorSelectionChange={handleEditorSelectionChange}
          onDeleteSelected={handleDeleteSelected}
          onRotateSelected={handleRotateSelected}
          onDragMove={handleDragMove}
          editorTick={editorTick}
          zoom={zoom}
          onZoomChange={setZoom}
          panRef={panRef}
        />

        {/* 줌 컨트롤 */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
          <button
            onClick={() => setZoom((z) => Math.min(10, z + 1))}
            className="w-8 h-8 bg-[#2A2A3A] border border-[#4a4a6a] text-white text-sm hover:bg-[#3A3A4A] flex items-center justify-center"
            title="줌 인"
          >
            +
          </button>
          <button
            onClick={() => setZoom(defaultZoom())}
            className="w-8 h-8 bg-[#2A2A3A] border border-[#4a4a6a] text-white text-xs hover:bg-[#3A3A4A] flex items-center justify-center"
            title="줌 리셋"
          >
            {zoom}x
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(1, z - 1))}
            className="w-8 h-8 bg-[#2A2A3A] border border-[#4a4a6a] text-white text-sm hover:bg-[#3A3A4A] flex items-center justify-center"
            title="줌 아웃"
          >
            −
          </button>
        </div>

        {/* 편집 모드 토글 */}
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={() => {
              setIsEditMode((v) => !v)
              editorStateRef.current.reset()
              tickEditor()
            }}
            className={`px-3 py-1.5 text-xs border font-mono ${
              isEditMode
                ? 'bg-[rgba(90,140,255,0.25)] border-[#5a8cff] text-white'
                : 'bg-[#2A2A3A] border-[#4a4a6a] text-[rgba(255,255,255,0.7)] hover:bg-[#3A3A4A]'
            }`}
          >
            {isEditMode ? '✓ Edit Mode' : 'Edit Layout'}
          </button>
        </div>

        {/* 편집 모드: EditorToolbar */}
        {isEditMode && (
          <EditorToolbar
            activeTool={editorStateRef.current.activeTool}
            selectedTileType={editorStateRef.current.selectedTileType}
            selectedFurnitureType={editorStateRef.current.selectedFurnitureType}
            selectedFurnitureUid={editorStateRef.current.selectedFurnitureUid}
            selectedFurnitureColor={selectedFurnitureColor}
            floorColor={editorStateRef.current.floorColor}
            wallColor={editorStateRef.current.wallColor}
            onToolChange={(tool) => {
              editorStateRef.current.activeTool = tool
              tickEditor()
            }}
            onTileTypeChange={(type) => {
              editorStateRef.current.selectedTileType = type
              tickEditor()
            }}
            onFloorColorChange={(color) => {
              editorStateRef.current.floorColor = color
              tickEditor()
            }}
            onWallColorChange={(color) => {
              editorStateRef.current.wallColor = color
              tickEditor()
            }}
            onSelectedFurnitureColorChange={handleSelectedFurnitureColorChange}
            onFurnitureTypeChange={(type) => {
              editorStateRef.current.selectedFurnitureType = type
              editorStateRef.current.activeTool = EditTool.FURNITURE_PLACE
              tickEditor()
            }}
          />
        )}
      </div>
    </div>
  )
}
