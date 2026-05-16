import { describe, expect, it } from 'vitest'
import type { SubtitleLine } from '../../types'
import {
  advanceReviewQueueId,
  buildGlobalReviewQueue,
  computeAlignmentRisk,
  isInAlignmentReviewQueue
} from './riskModel'

function baseLine(id: number, patch: Partial<SubtitleLine>): SubtitleLine {
  return {
    id,
    start: 0,
    end: 1000,
    chinese: '测试',
    english: '',
    confidence: 0,
    status: 'unmatched',
    candidates: [],
    problems: [],
    manuallyEdited: false,
    matchedSegmentIds: [],
    ...patch
  }
}

describe('isInAlignmentReviewQueue', () => {
  it('includes needs_review, low_confidence, unmatched', () => {
    expect(isInAlignmentReviewQueue(baseLine(1, { status: 'needs_review' }))).toBe(true)
    expect(isInAlignmentReviewQueue(baseLine(2, { status: 'low_confidence', english: 'ok', confidence: 50 }))).toBe(
      true
    )
    expect(isInAlignmentReviewQueue(baseLine(3, { status: 'unmatched', english: 'x' }))).toBe(true)
  })

  it('includes manual with problems or empty english', () => {
    expect(isInAlignmentReviewQueue(baseLine(4, { status: 'manual', english: '', problems: [] }))).toBe(true)
    expect(
      isInAlignmentReviewQueue(baseLine(5, { status: 'manual', english: 'ok', problems: ['ai_alignment:no_match'] }))
    ).toBe(true)
  })

  it('excludes confirmed and clean manual', () => {
    expect(isInAlignmentReviewQueue(baseLine(6, { status: 'confirmed', english: 'ok', confidence: 95 }))).toBe(
      false
    )
    expect(isInAlignmentReviewQueue(baseLine(7, { status: 'manual', english: 'ok', problems: [] }))).toBe(false)
  })
})

describe('buildGlobalReviewQueue', () => {
  it('orders higher risk first', () => {
    const a = baseLine(1, { status: 'low_confidence', english: 'e', confidence: 50, problems: [] })
    const b = baseLine(2, {
      status: 'needs_review',
      english: '',
      confidence: 0,
      problems: ['ai_alignment:semantic_undersegmentation']
    })
    const q = buildGlobalReviewQueue([a, b], { confidenceThresholdPct: 60 })
    expect(q.map((e) => e.line.id)).toEqual([2, 1])
  })
})

describe('advanceReviewQueueId', () => {
  it('wraps forward and backward', () => {
    const ids = [10, 20, 30]
    expect(advanceReviewQueueId(ids, 20, 1)).toBe(30)
    expect(advanceReviewQueueId(ids, 30, 1)).toBe(10)
    expect(advanceReviewQueueId(ids, 10, -1)).toBe(30)
  })

  it('jumps to first when current not in queue', () => {
    expect(advanceReviewQueueId([1, 2], 99, 1)).toBe(1)
  })
})

describe('computeAlignmentRisk', () => {
  it('returns band and non-negative score', () => {
    const r = computeAlignmentRisk(
      baseLine(1, { status: 'needs_review', english: '', problems: ['x', 'y'], confidence: 0 }),
      { confidenceThresholdPct: 60 }
    )
    expect(r.score).toBeGreaterThan(0)
    expect(['low', 'elevated', 'high']).toContain(r.band)
  })
})
