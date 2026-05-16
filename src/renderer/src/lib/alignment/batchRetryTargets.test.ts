import { describe, expect, it } from 'vitest'
import { buildBatchRetryTargetIds, isBatchRetryTarget, MAX_BATCH_RETRY_ITEMS_PER_RUN } from './batchRetryTargets'
import type { SubtitleLine } from '../../types'

function line(over: Partial<SubtitleLine>): SubtitleLine {
  return {
    id: 1,
    start: 0,
    end: 1000,
    chinese: 'x',
    english: 'en',
    confidence: 80,
    status: 'needs_review',
    candidates: [],
    problems: [],
    manuallyEdited: false,
    matchedSegmentIds: [],
    ...over
  }
}

describe('isBatchRetryTarget', () => {
  it('excludes confirmed and manual', () => {
    expect(isBatchRetryTarget(line({ status: 'confirmed' }))).toBe(false)
    expect(isBatchRetryTarget(line({ status: 'manual' }))).toBe(false)
  })

  it('excludes manuallyEdited', () => {
    expect(isBatchRetryTarget(line({ status: 'needs_review', manuallyEdited: true }))).toBe(false)
  })

  it('includes needs_review', () => {
    expect(isBatchRetryTarget(line({ status: 'needs_review' }))).toBe(true)
  })

  it('includes ai_alignment problem', () => {
    expect(isBatchRetryTarget(line({ status: 'confirmed', problems: ['ai_alignment:x'] }))).toBe(false)
    expect(isBatchRetryTarget(line({ status: 'needs_review', problems: ['ai_alignment:x'] }))).toBe(true)
  })
})

describe('buildBatchRetryTargetIds', () => {
  it('caps at MAX', () => {
    const many: SubtitleLine[] = Array.from({ length: MAX_BATCH_RETRY_ITEMS_PER_RUN + 10 }, (_, i) =>
      line({
        id: i + 1,
        status: 'needs_review',
        english: '',
        chinese: String(i)
      })
    )
    const r = buildBatchRetryTargetIds(many, 60)
    expect(r.ids.length).toBe(MAX_BATCH_RETRY_ITEMS_PER_RUN)
    expect(r.truncated).toBe(true)
  })
})
