import { describe, expect, it } from 'vitest'
import type { ScriptSegment, SubtitleLine } from '../../types'
import {
  computeBatchMidRatio,
  computeEnglishCenterIndex,
  computeEnglishWindowSegmentRange,
  computeSubtitleTimeline
} from './timeRatioContext'

function sub(id: number, start: number, end: number): SubtitleLine {
  return {
    id,
    start,
    end,
    chinese: 'x',
    english: '',
    confidence: 0,
    status: 'unmatched',
    candidates: [],
    problems: [],
    manuallyEdited: false,
    matchedSegmentIds: []
  }
}

describe('timeRatioContext', () => {
  it('computes timeline and batch mid ratio', () => {
    const all = [sub(1, 0, 1000), sub(2, 1000, 2000), sub(3, 2000, 3000)]
    const { timelineStartMs, totalDurationMs } = computeSubtitleTimeline(all)
    expect(timelineStartMs).toBe(0)
    expect(totalDurationMs).toBe(3000)

    const batch = [sub(2, 1000, 2000)]
    const { batchMidRatio } = computeBatchMidRatio(batch, timelineStartMs, totalDurationMs)
    expect(batchMidRatio).toBeCloseTo(0.5, 5)
  })

  it('maps ratio to english center and window', () => {
    expect(computeEnglishCenterIndex(0.5, 100)).toBe(50)
    const w = computeEnglishWindowSegmentRange(50, 100, 25, 35)
    expect(w.windowStartSeg).toBe(25)
    expect(w.windowEndSeg).toBe(85)
  })
})
