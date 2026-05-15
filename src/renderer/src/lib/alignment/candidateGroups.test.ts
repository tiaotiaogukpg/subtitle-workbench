import { describe, expect, it } from 'vitest'
import type { ScriptSegment } from '../../types'
import { buildCandidateGroups, normalizeGroupText } from './candidateGroups'

function en(id: string, text: string): ScriptSegment {
  return {
    id,
    text,
    language: 'english',
    sourceLine: 1,
    used: true
  }
}

describe('buildCandidateGroups (debug singletons)', () => {
  it('emits one group per segment in window', () => {
    const pool = [en('a', 'Hello there'), en('b', 'Second bit')]
    const groups = buildCandidateGroups({ englishSegments: pool, cursor: 0, windowSize: 10 })
    expect(groups.length).toBe(2)
    expect(groups.every((g) => g.segmentIds.length === 1)).toBe(true)
    expect(groups[0]!.id).toBe('g_0_0')
    expect(groups[1]!.id).toBe('g_1_1')
  })

  it('normalizes whitespace in group text', () => {
    expect(normalizeGroupText('  a   b  ')).toBe('a b')
  })
})
