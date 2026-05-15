/**
 * 英文原稿轻量规范化 + 粗边界（调试用）。
 * 最终字幕颗粒度由 AI 在局部上下文中自行切分；此处不做语义/情绪启发式。
 */

export type SemanticSplitReason = 'sentence' | 'question' | 'line_break' | 'coarse'

export interface SemanticClause {
  id: string
  text: string
  /** 该 clause 所出自的原始输入行。 */
  sourceText: string
  wordCount: number
  charCount: number
  splitReason: SemanticSplitReason
}

const COARSE_MAX_WORDS = 42

export function countWords(s: string): number {
  const t = s.trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

function newId(): string {
  return crypto.randomUUID()
}

export function isQuestionTerminated(text: string): boolean {
  return text.trim().endsWith('?')
}

export function isQuestionClause(text: string): boolean {
  const t = text.trim()
  if (!t.endsWith('?')) return false
  return /^(?:which|what|who|whom|how|why|when|where|do|does|did|is|are|can|could|would|if)\b/i.test(
    t
  )
}

/** 句末强切：. ! ? 后接空白。 */
function splitStrongSentences(line: string): Array<{ text: string; reason: SemanticSplitReason }> {
  const t = line.trim()
  if (!t) return []
  const parts = t.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)
  return parts.map((text) => ({
    text,
    reason: isQuestionTerminated(text) ? 'question' : 'sentence'
  }))
}

/** 仅当单段过长时按词数中分（粗边界）。 */
function maybeCoarseSplit(text: string, reason: SemanticSplitReason): Array<{ text: string; reason: SemanticSplitReason }> {
  const t = text.trim()
  const wc = countWords(t)
  if (wc <= COARSE_MAX_WORDS) return [{ text: t, reason }]
  const words = t.split(/\s+/).filter(Boolean)
  const mid = Math.floor(words.length / 2)
  const left = words.slice(0, mid).join(' ')
  const right = words.slice(mid).join(' ')
  return [
    ...maybeCoarseSplit(left, 'coarse'),
    ...maybeCoarseSplit(right, 'coarse')
  ]
}

function processLine(line: string): SemanticClause[] {
  const lineTrim = line.trim()
  if (!lineTrim) return []
  const strong = splitStrongSentences(lineTrim)
  const flat = strong.flatMap((s) => maybeCoarseSplit(s.text, s.reason))
  return flat.map((m) => {
    const raw = m.text.trim()
    const preserveQuestionMark = isQuestionClause(raw)
    const text = preserveQuestionMark ? raw : raw.replace(/[.!?]+$/u, '').trim()
    return {
      id: newId(),
      text,
      sourceText: lineTrim,
      wordCount: countWords(text),
      charCount: text.length,
      splitReason: m.reason === 'question' || isQuestionTerminated(raw) ? 'question' : m.reason
    }
  })
}

/**
 * 粗切英文：换行 → 句末标点 → 过长按词数二分。
 * 供调试可视化；不作为对齐主流程的权威切句。
 */
export function parseEnglishSemanticClauses(text: string): SemanticClause[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const out: SemanticClause[] = []

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!.trim()
    if (!line) continue
    const lineClauses = processLine(line)
    for (let ci = 0; ci < lineClauses.length; ci++) {
      let c = lineClauses[ci]!
      if (li > 0 && ci === 0 && c.splitReason !== 'question') {
        c = { ...c, splitReason: 'line_break' }
      }
      out.push(c)
    }
  }
  return out
}