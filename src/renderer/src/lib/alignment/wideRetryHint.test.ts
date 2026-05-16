import { describe, expect, it } from 'vitest'
import { computeWideRetrySuggestion } from './wideRetryHint'
import type { SubtitleLine } from '../../types'

function baseLine(over: Partial<SubtitleLine>): SubtitleLine {
  return {
    id: 1,
    start: 0,
    end: 1000,
    chinese: '测',
    english: 'hello',
    confidence: 80,
    status: 'confirmed',
    candidates: [],
    problems: [],
    manuallyEdited: false,
    matchedSegmentIds: [],
    ...over
  }
}

describe('computeWideRetrySuggestion', () => {
  it('suggests when english empty', () => {
    const r = computeWideRetrySuggestion({
      line: baseLine({ english: '   ' }),
      dupIds: new Map(),
      confidenceThresholdPct: 60
    })
    expect(r.suggest).toBe(true)
    expect(r.reasons.some((x) => x.includes('英文为空'))).toBe(true)
  })

  it('suggests on duplicate attempt map', () => {
    const r = computeWideRetrySuggestion({
      line: baseLine({}),
      dupIds: new Map([['a', true]]),
      confidenceThresholdPct: 60
    })
    expect(r.suggest).toBe(true)
  })

  it('suggests on low confidence with english', () => {
    const r = computeWideRetrySuggestion({
      line: baseLine({ english: 'x', confidence: 40 }),
      dupIds: new Map(),
      confidenceThresholdPct: 60
    })
    expect(r.suggest).toBe(true)
  })
})
