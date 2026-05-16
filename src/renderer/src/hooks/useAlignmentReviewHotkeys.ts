import { type MutableRefObject, useEffect } from 'react'

export function isReviewHotkeyTargetBlocked(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

/** 仅在侧栏字幕列表或对齐复查工作区内响应快捷键（避免在全局 UI 误触）。 */
export function isReviewHotkeySurfaceAllowed(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null
  if (!el) return false
  return Boolean(
    el.closest('[data-review-hotkeys="true"]') || el.closest('[data-alignment-review-surface="true"]')
  )
}

export interface AlignmentReviewHotkeyHandlers {
  goNextReview: () => void
  goPrevReview: () => void
  stepAttempt: (dir: -1 | 1) => void
  applySelectedAttempt: () => void
  retryLine: (wide: boolean) => void
  markConfirmed: () => void
  focusEnglish: () => void
}

/** Phase 4B：在复查工作区 / 字幕侧栏、且非表单焦点时启用快捷键（J/K、A/D、Enter、R、M、E）。 */
export function useAlignmentReviewHotkeys(
  enabled: boolean,
  handlersRef: MutableRefObject<AlignmentReviewHotkeyHandlers | null>
): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (typeof document !== 'undefined' && document.querySelector('[data-attempt-compare-open]')) {
        return
      }
      if (isReviewHotkeyTargetBlocked(e.target)) return
      if (!isReviewHotkeySurfaceAllowed(e.target)) return

      const h = handlersRef.current
      if (!h) return

      const t = e.target instanceof HTMLElement ? e.target : null
      if (e.code === 'Enter' && t?.closest('button, a[href], [role="button"]')) {
        return
      }

      if (e.code === 'KeyJ') {
        e.preventDefault()
        h.goNextReview()
        return
      }
      if (e.code === 'KeyK') {
        e.preventDefault()
        h.goPrevReview()
        return
      }
      if (e.code === 'KeyA') {
        e.preventDefault()
        h.stepAttempt(-1)
        return
      }
      if (e.code === 'KeyD') {
        e.preventDefault()
        h.stepAttempt(1)
        return
      }
      if (e.code === 'Enter') {
        e.preventDefault()
        h.applySelectedAttempt()
        return
      }
      if (e.code === 'KeyR') {
        e.preventDefault()
        h.retryLine(e.shiftKey)
        return
      }
      if (e.code === 'KeyM') {
        e.preventDefault()
        h.markConfirmed()
        return
      }
      if (e.code === 'KeyE') {
        e.preventDefault()
        h.focusEnglish()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, handlersRef])
}
