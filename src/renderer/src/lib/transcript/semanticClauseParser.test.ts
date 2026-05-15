import { describe, expect, it } from 'vitest'
import {
  isQuestionClause,
  isShortStandalone,
  parseEnglishSemanticClauses
} from './semanticClauseParser'

describe('parseEnglishSemanticClauses', () => {
  it('splits interview paragraph into semantic-sized clauses', () => {
    const input =
      "I wasn't watching. I wasn't keeping track of it. So two weeks ago I was like wait, what? And so I'm pretty stoked on that."
    const clauses = parseEnglishSemanticClauses(input)
    const texts = clauses.map((c) => c.text)
    expect(texts).toContain("I wasn't watching")
    expect(texts).toContain("I wasn't keeping track of it")
    expect(texts.some((t) => /So two weeks ago/i.test(t) && /wait, what/i.test(t))).toBe(true)
    expect(texts.some((t) => /pretty stoked/i.test(t))).toBe(true)
    expect(clauses.some((c) => c.splitReason === 'question')).toBe(true)
  })

  it('keeps WH question as its own clause', () => {
    const input = 'Some intro. Which solo collaboration are you most proud of? I think the second one.'
    const clauses = parseEnglishSemanticClauses(input)
    const q = clauses.find((c) => c.text.includes('Which solo'))
    expect(q).toBeDefined()
    expect(q!.splitReason).toBe('question')
    expect(q!.text.endsWith('?')).toBe(true)
  })

  it('marks greeting / reaction as short_response without merging away', () => {
    const input = 'Hi. Yeah. I think we should move on.'
    const clauses = parseEnglishSemanticClauses(input)
    const hi = clauses.find((c) => c.text === 'Hi')
    const yeah = clauses.find((c) => c.text === 'Yeah')
    expect(hi?.splitReason).toBe('short_response')
    expect(yeah?.splitReason).toBe('short_response')
  })

  it('splits very long clause by length', () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ')
    const clauses = parseEnglishSemanticClauses(words)
    expect(clauses.length).toBeGreaterThan(1)
    expect(clauses.every((c) => c.wordCount <= 18)).toBe(true)
    expect(clauses.some((c) => c.splitReason === 'length')).toBe(true)
  })

  it('uses line_break for first clause of second line when appropriate', () => {
    const input = "First line here.\nSecond line starts."
    const clauses = parseEnglishSemanticClauses(input)
    const secondLineFirst = clauses.find((c) => c.text.startsWith('Second'))
    expect(secondLineFirst?.splitReason).toBe('line_break')
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

describe('isShortStandalone', () => {
  it('allows Wow and What?', () => {
    expect(isShortStandalone('Wow')).toBe(true)
    expect(isShortStandalone('What?')).toBe(true)
  })
  it('rejects arbitrary short fragment', () => {
    expect(isShortStandalone('to')).toBe(false)
  })
})
