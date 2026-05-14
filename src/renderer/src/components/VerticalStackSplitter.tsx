import { useCallback, useRef, useState, type JSX, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'

const HANDLE_PX = 8
const MIN_TOP_PX = 100
const MIN_BOTTOM_PX = 100

export function VerticalStackSplitter({
  top,
  bottom,
  defaultTopRatio = 0.52
}: {
  top: ReactNode
  bottom: ReactNode
  /** 上半部分占（不含把手）可分配高度的比例。 */
  defaultTopRatio?: number
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [topRatio, setTopRatio] = useState(() => clampTopRatio(defaultTopRatio, 1000))

  const applyPointer = useCallback((clientY: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const inner = rect.height - HANDLE_PX
    if (inner <= MIN_TOP_PX + MIN_BOTTOM_PX) return
    const y = clientY - rect.top
    const topPixels = y - HANDLE_PX / 2
    const r = topPixels / inner
    setTopRatio(clampTopRatio(r, inner))
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      applyPointer(event.clientY)
    },
    [applyPointer]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      applyPointer(event.clientY)
    },
    [applyPointer]
  )

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const w1 = Math.round(topRatio * 1000) / 10
  const w2 = 100 - w1

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ flex: `${w1} 1 0px`, minHeight: MIN_TOP_PX }}
      >
        {top}
      </div>
      <button
        type="button"
        className="stack-split-handle"
        aria-label="拖动调节上下区域高度"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(topRatio * 100)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ flex: `${w2} 1 0px`, minHeight: MIN_BOTTOM_PX }}
      >
        {bottom}
      </div>
    </div>
  )
}

function clampTopRatio(ratio: number, innerHeight: number): number {
  const inner = Math.max(innerHeight, MIN_TOP_PX + MIN_BOTTOM_PX + 1)
  const minR = MIN_TOP_PX / inner
  const maxR = (inner - MIN_BOTTOM_PX) / inner
  return Math.max(minR, Math.min(maxR, ratio))
}
