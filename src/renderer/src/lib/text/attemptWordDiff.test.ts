import { describe, expect, it } from 'vitest'
import { buildAttemptWordDiff } from './attemptWordDiff'

describe('buildAttemptWordDiff', () => {
  it('marks insertion and deletion', () => {
    const from = 'And I went to Bodyguard and I got caught'
    const to = 'And I went to Bodyguard'
    const d = buildAttemptWordDiff(from, to)
    const joined = d.map((x) => `${x.type}:${x.text}`).join('|')
    expect(joined).toContain('del:')
    expect(joined).toContain('eq:')
  })

  it('all eq when identical', () => {
    const d = buildAttemptWordDiff('hello world', 'hello world')
    expect(d.every((x) => x.type === 'eq')).toBe(true)
  })
})
