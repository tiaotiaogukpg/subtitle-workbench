import { useScriptPoolStore } from '../../store/scriptPoolStore'
import { useSubtitleStore } from '../../store/subtitleStore'
import type { SubtitleAiAttemptSource } from '../../types'
import { runSingleSubtitleAlignmentRetry } from './singleSubtitleAlignmentRetry'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface BatchRetryLoopCallbacks {
  /** false = 已 stop 或 runId 失效，不再继续 */
  shouldContinue: () => boolean
  isPaused: () => boolean
  onLineStart: (subtitleId: number, index: number, total: number) => void
  onLineDone: (subtitleId: number, completed: number, total: number) => void
}

/**
 * 串行对多行调用 `runSingleSubtitleAlignmentRetry`，仅追加 attempts；支持 pause/stop 轮询。
 */
export async function runBatchRetryQueue(input: {
  targetIds: number[]
  wide: boolean
  attemptSource: Extract<SubtitleAiAttemptSource, 'batch_retry' | 'batch_wide_retry'>
  model: string
  confidenceThresholdPct: number
  guardRunId?: number
  callbacks: BatchRetryLoopCallbacks
}): Promise<'completed' | 'stopped'> {
  const { targetIds, wide, attemptSource, model, confidenceThresholdPct, guardRunId, callbacks } = input
  const total = targetIds.length

  for (let i = 0; i < total; i++) {
    while (callbacks.isPaused() && callbacks.shouldContinue()) {
      await sleep(180)
    }
    if (!callbacks.shouldContinue()) return 'stopped'

    const id = targetIds[i]!
    callbacks.onLineStart(id, i, total)

    if (!callbacks.shouldContinue()) return 'stopped'

    const st = useSubtitleStore.getState()
    const line = st.subtitles.find((l) => l.id === id)
    if (line) {
      await runSingleSubtitleAlignmentRetry({
        line,
        subtitles: st.subtitles,
        segments: useScriptPoolStore.getState().segments,
        model,
        confidenceThresholdPct,
        wide,
        attemptSource,
        guardRunId
      })
    }

    if (!callbacks.shouldContinue()) return 'stopped'

    callbacks.onLineDone(id, i + 1, total)
  }

  return 'completed'
}
