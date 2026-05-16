import { describe, expect, it, vi } from 'vitest'
import { _resetOperationGuardForTests, isActiveRun, startAiOperation } from './operationGuard'
import { runBatchRetryQueue } from './runBatchRetryQueue'

vi.mock('./singleSubtitleAlignmentRetry', () => ({
  runSingleSubtitleAlignmentRetry: vi.fn(async () => ({ ok: true as const }))
}))

vi.mock('../../store/subtitleStore', () => ({
  useSubtitleStore: {
    getState: () => ({
      subtitles: [{ id: 1, chinese: 'a', english: '', start: 0, end: 1000, confidence: 50, status: 'pending', problems: [], candidates: [] }]
    })
  }
}))

vi.mock('../../store/scriptPoolStore', () => ({
  useScriptPoolStore: {
    getState: () => ({ segments: [] })
  }
}))

import { runSingleSubtitleAlignmentRetry } from './singleSubtitleAlignmentRetry'

describe('runBatchRetryQueue', () => {
  it('stops before starting the next line when shouldContinue is false', async () => {
    _resetOperationGuardForTests()
    const started = startAiOperation('batch_retry', { totalCount: 3 })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { operationId } = started

    const onLineStart = vi.fn()
    let stopAfterFirst = false

    const outcome = await runBatchRetryQueue({
      targetIds: [1, 2, 3],
      wide: false,
      attemptSource: 'batch_retry',
      model: 'deepseek-chat',
      confidenceThresholdPct: 70,
      guardRunId: operationId,
      callbacks: {
        shouldContinue: () => !stopAfterFirst,
        isPaused: () => false,
        onLineStart,
        onLineDone: () => {
          stopAfterFirst = true
        }
      }
    })

    expect(outcome).toBe('stopped')
    expect(runSingleSubtitleAlignmentRetry).toHaveBeenCalledTimes(1)
    expect(onLineStart).toHaveBeenCalledTimes(1)
    expect(isActiveRun(operationId)).toBe(true)
  })
})
