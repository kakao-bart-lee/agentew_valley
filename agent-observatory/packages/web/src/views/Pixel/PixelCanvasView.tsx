/**
 * PixelCanvasView - 픽셀 사무실 에이전트 시각화 뷰
 *
 * agentStore의 에이전트 상태를 구독하여 Canvas 2D로 렌더링.
 * 레이아웃은 localStorage에 저장/복원.
 */

import { useRef, useState, useCallback, useEffect } from 'react'
import { OfficeState } from '../../pixel/engine/officeState'
import { PixelOfficeCanvas } from '../../pixel/components/PixelOfficeCanvas'
import { useAgentBridge } from '../../pixel/hooks/useAgentBridge'
import { createDefaultLayout, deserializeLayout } from '../../pixel/layout/layoutSerializer'
import { defaultZoom } from '../../pixel/toolUtils'
import { loadAllSproutAssets } from '../../pixel/sprites/sproutAssetLoader'

const LAYOUT_STORAGE_KEY = 'pixel-office-layout'

function loadSavedLayout() {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (saved) return deserializeLayout(saved)
  } catch {
    // ignore
  }
  return null
}

export function PixelCanvasView() {
  // OfficeState: 레이아웃 로드 후 초기화
  const officeStateRef = useRef<OfficeState | null>(null)
  if (!officeStateRef.current) {
    const savedLayout = loadSavedLayout()
    officeStateRef.current = new OfficeState(savedLayout ?? createDefaultLayout())
  }

  const panRef = useRef({ x: 0, y: 0 })

  const [zoom, setZoom] = useState(() => {
    const layout = officeStateRef.current?.getLayout()
    return defaultZoom(layout?.cols, layout?.rows)
  })

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

  return (
    <div className="flex-1 w-full min-h-0 overflow-hidden bg-[#1E1E2E] flex flex-col relative">
      {/* 캔버스 영역 */}
      <div className="flex-1 relative min-h-0">
        <PixelOfficeCanvas
          officeState={officeStateRef.current}
          onClick={() => {}}
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
            onClick={() => {
              const layout = officeStateRef.current?.getLayout()
              setZoom(defaultZoom(layout?.cols, layout?.rows))
            }}
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
      </div>
    </div>
  )
}
