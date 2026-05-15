import { describe, expect, it } from 'vitest'
import { isQuestionClause, parseEnglishSemanticClauses } from './semanticClauseParser'

describe('parseEnglishSemanticClauses (coarse debug only)', () => {
  it('splits on sentence boundaries', () => {
    const input = "First sentence. Second sentence!"
    const clauses = parseEnglishSemanticClauses(input)
    expect(clauses.length).toBeGreaterThanOrEqual(2)
    expect(clauses.some((c) => /First sentence/i.test(c.text))).toBe(true)
    expect(clauses.some((c) => /Second sentence/i.test(c.text))).toBe(true)
  })

  it('marks WH question clauses', () => {
    const input = 'Intro. Which way did he go?'
    const clauses = parseEnglishSemanticClauses(input)
    const q = clauses.find((c) => c.text.includes('Which way'))
    expect(q?.splitReason).toBe('question')
  })

  it('splits very long single sentence by coarse word split', () => {
    const words = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ')
    const clauses = parseEnglishSemanticClauses(words)
    expect(clauses.length).toBeGreaterThan(1)
    expect(clauses.some((c) => c.splitReason === 'coarse')).toBe(true)
  })

  it('uses line_break for first clause of second line', () => {
    const input = "Line one.\nLine two."
    const clauses = parseEnglishSemanticClauses(input)
    const second = clauses.find((c) => c.text.startsWith('Line two'))
    expect(second?.splitReason).toBe('line_break')
  })
})

describe('isQuestionClause', () => {
  it('detects WH questions', () => {
    expect(isQuestionClause('Which way did he go?')).toBe(true)
  })
  it('does not tag informal trailing question', () => {
    expect(isQuestionClause('wait, what?')).toBe(false)
  })
})
