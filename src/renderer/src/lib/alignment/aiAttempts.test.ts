import { describe, expect, it } from 'vitest'
import type { SubtitleLine } from '../../types'
import { suggestBestAttempt } from './aiAttempts'

function line(
  id: number,
  patch: Partial<SubtitleLine> & Pick<SubtitleLine, 'english' | 'aiAttempts'>
): SubtitleLine {
  return {
    id,
    start: 0,
    end: 1000,
    chinese: '测',
    confidence: 80,
    status: 'low_confidence',
    candidates: [],
    problems: [],
    manuallyEdited: false,
    matchedSegmentIds: [],
    ...patch
  }
}

describe('suggestBestAttempt', () => {
  it('prefers fewer problems and higher confidence', () => {
    const cur = line(2, {
      english: 'applied',
      aiAttempts: [
        {
          id: 'a',
          createdAt: 1,
          source: 'single_retry',
          english: 'good',
          confidence: 70,
          problems: ['AI confidence is low.'],
          globalSpanStart: 100,
          globalSpanEnd: 110
        },
        {
          id: 'b',
          createdAt: 2,
          source: 'single_retry',
          english: 'better',
          confidence: 95,
          problems: [],
          globalSpanStart: 200,
          globalSpanEnd: 210
        }
      ]
    })
    const all: SubtitleLine[] = [
      line(1, { english: 'x', aiAttempts: [] }),
      cur,
      line(3, { english: 'y', aiAttempts: [] })
    ]
    const best = suggestBestAttempt(cur, all)
    expect(best?.id).toBe('b')
  })

  it('excludes Chinese-in-english attempts', () => {
    const cur = line(1, {
      english: 'ok',
      aiAttempts: [
        {
          id: 'cjk',
          createdAt: 1,
          source: 'retry',
          english: 'bad中文',
          confidence: 99,
          problems: []
        },
        {
          id: 'en',
          createdAt: 2,
          source: 'retry',
          english: 'fine',
          confidence: 50,
          problems: ['x']
        }
      ]
    })
    const best = suggestBestAttempt(cur, [cur])
    expect(best?.id).toBe('en')
  })
})
