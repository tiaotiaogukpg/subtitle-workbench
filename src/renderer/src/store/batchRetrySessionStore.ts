import { create } from 'zustand'
import { buildBatchRetryTargetIds } from '../lib/alignment/batchRetryTargets'
import { runBatchRetryQueue } from '../lib/alignment/runBatchRetryQueue'
import { isAlignmentSessionActive, useAlignmentSessionStore } from './alignmentSessionStore'
import { useSubtitleStore } from './subtitleStore'

export type BatchRetrySessionStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed'

export interface BatchRetrySessionState {
  status: BatchRetrySessionStatus
  wide: boolean
  targetIds: number[]
  total: number
  completed: number
  currentSubtitleId: number | null
  lastError: string | null
  truncated: boolean
  rawTargetCount: number
  pauseRequested: boolean
  stopRequested: boolean
}

const idleState: BatchRetrySessionState = {
  status: 'idle',
  wide: false,
  targetIds: [],
  total: 0,
  completed: 0,
  currentSubtitleId: null,
  lastError: null,
  truncated: false,
  rawTargetCount: 0,
  pauseRequested: false,
  stopRequested: false
}

interface BatchRetrySessionActions {
  requestPause: () => void
  requestResume: () => void
  requestStop: () => void
  reset: () => void
  startBatchRetry: (input: { wide: boolean; model: string; confidenceThresholdPct: number }) => Promise<void>
}

export type BatchRetrySessionStore = BatchRetrySessionState & BatchRetrySessionActions

let runGeneration = 0

export const useBatchRetrySessionStore = create<BatchRetrySessionStore>((set, get) => ({
  ...idleState,

  reset: () => {
    const s = get()
    if (s.status === 'running' || s.status === 'paused') return
    set({ ...idleState })
  },

  requestPause: () => {
    const s = get()
    if (s.status === 'running') set({ pauseRequested: true, status: 'paused' })
  },

  requestResume: () => {
    const s = get()
    if (s.status === 'paused') set({ pauseRequested: false, status: 'running' })
  },

  requestStop: () => {
    set({ stopRequested: true, pauseRequested: false })
  },

  startBatchRetry: async ({ wide, model, confidenceThresholdPct }) => {
    const gen = ++runGeneration
    if (get().status === 'running' || get().status === 'paused') return
    if (isAlignmentSessionActive(useAlignmentSessionStore.getState().status)) {
      set({ lastError: '整文件对齐会话进行中，无法启动批量重试' })
      return
    }

    const subtitles = useSubtitleStore.getState().subtitles
    const { ids, truncated, rawCount } = buildBatchRetryTargetIds(subtitles, confidenceThresholdPct)

    if (ids.length === 0) {
      set({
        ...idleState,
        lastError: '当前没有符合批量重试条件的复查队列项'
      })
      return
    }

    if (truncated) {
      window.alert(
        `复查队列中符合条件的有 ${rawCount} 条，超过单轮上限 ${ids.length} 条；本次仅处理前 ${ids.length} 条，请分批再跑。`
      )
    }

    set({
      status: 'running',
      wide,
      targetIds: ids,
      total: ids.length,
      completed: 0,
      currentSubtitleId: null,
      lastError: null,
      truncated,
      rawTargetCount: rawCount,
      pauseRequested: false,
      stopRequested: false
    })

    const attemptSource = wide ? ('batch_wide_retry' as const) : ('batch_retry' as const)

    try {
      const outcome = await runBatchRetryQueue({
        targetIds: ids,
        wide,
        attemptSource,
        model,
        confidenceThresholdPct,
        callbacks: {
          isPaused: () => get().pauseRequested,
          isStopRequested: () => get().stopRequested,
          onLineStart: (subtitleId) => {
            if (gen !== runGeneration) return
            set({ currentSubtitleId: subtitleId })
          },
          onLineDone: (subtitleId, completed, _total) => {
            if (gen !== runGeneration) return
            set({ completed, currentSubtitleId: subtitleId })
          }
        }
      })

      if (gen !== runGeneration) return

      if (outcome === 'stopped') {
        set({ status: 'stopped', currentSubtitleId: null })
      } else {
        set({ status: 'completed', currentSubtitleId: null })
      }
    } catch (err) {
      if (gen !== runGeneration) return
      const msg = err instanceof Error ? err.message : String(err)
      set({
        status: 'stopped',
        currentSubtitleId: null,
        lastError: msg
      })
    }
  }
}))
