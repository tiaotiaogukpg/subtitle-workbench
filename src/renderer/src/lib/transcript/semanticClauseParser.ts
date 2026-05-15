/**
 * 英文原稿 → semantic clause 流（第一版）。
 * 仅处理纯英文文本；不接 DeepSeek / candidateGroups。
 */

export type SemanticSplitReason =
  | 'sentence'
  | 'comma'
  | 'discourse_marker'
  | 'quote'
  | 'question'
  | 'length'
  | 'line_break'
  | 'short_response'

export interface SemanticClause {
  id: string
  text: string
  /** 该 clause 所出自的原始输入行。 */
  sourceText: string
  wordCount: number
  charCount: number
  splitReason: SemanticSplitReason
}

const MIN_MERGE_WORDS = 3
const HARD_MAX = 18

const SHORT_STANDALONE = new Set(
  [
    'hi',
    'hey',
    'hello',
    'welcome',
    'good',
    'thanks',
    'yeah',
    'yes',
    'no',
    'okay',
    'ok',
    'right',
    'exactly',
    'wow',
    'oh',
    'ah',
    'hmm',
    'sure',
    'maybe'
  ].map((w) => w.toLowerCase())
)

export function countWords(s: string): number {
  const t = s.trim()
  if (!t) return 0
  return t.split(/\s+/).filter(Boolean).length
}

function newId(): string {
  return crypto.randomUUID()
}

function stripEdgePunct(s: string): string {
  return s.replace(/^[\s"'“”‘’]+|[\s"'“”‘’!.?,;:]+$/g, '').trim()
}

export function isQuestionClause(text: string): boolean {
  const t = text.trim()
  if (!t.endsWith('?')) return false
  return /^(?:which|what|who|whom|how|why|when|where|do|does|did|is|are|can|could|would|if)\b/i.test(
    t
  )
}

/** 任意以问号收尾的句子：合并时独立，不并入前后。 */
export function isQuestionTerminated(text: string): boolean {
  return text.trim().endsWith('?')
}

export function isShortStandalone(text: string): boolean {
  const t = text.trim()
  const wc = countWords(t)
  if (wc >= MIN_MERGE_WORDS) return false
  if (wc === 0) return false
  const core = stripEdgePunct(t).toLowerCase()
  if (!core) return false
  const firstTok = core.split(/\s+/)[0] ?? ''
  if (SHORT_STANDALONE.has(firstTok)) return true
  if (/^(what|why)\??$/i.test(core)) return true
  return false
}

/** 句级强切：. ! ? 后接空白。 */
function splitStrongSentences(line: string): Array<{ text: string; reason: SemanticSplitReason }> {
  const t = line.trim()
  if (!t) return []
  const parts = t.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)
  return parts.map((text) => ({
    text,
    reason: isQuestionTerminated(text) ? 'question' : 'sentence'
  }))
}

/** 输出时弱边界统一记为 comma（含 , ; : — …）。 */
const WEAK_SPLITTERS: Array<{ findNext: (t: string, from: number) => number }> = [
  {
    findNext: (t, from) => {
      for (let i = from; i < t.length; i++) {
        const ch = t[i]!
        if (ch === ',' || ch === '，' || ch === ';' || ch === '；' || ch === ':' || ch === '：') {
          let j = i + 1
          while (j < t.length && /\s/.test(t[j]!)) j++
          if (j < t.length) return j
        }
        if ((ch === '—' || ch === '–') && i > 0 && /\s/.test(t[i - 1]!) && i + 1 < t.length && /\s/.test(t[i + 1]!)) {
          let j = i + 1
          while (j < t.length && /\s/.test(t[j]!)) j++
          if (j < t.length) return j
        }
        if (t.slice(i, i + 3) === '...') {
          let j = i + 3
          while (j < t.length && /\s/.test(t[j]!)) j++
          if (j < t.length) return j
        }
      }
      return -1
    }
  }
]

const DISCOURSE_RE = /\s+(?=(?:and\s+so|because|honestly|actually|but|then|well|still|\bso\b)\b)/gi

const QUOTE_RE = /\s*"\s+/g

function splitOnceAt(
  text: string,
  index: number,
  reason: SemanticSplitReason
): [string, string] | null {
  const t = text.trim()
  if (index <= 0 || index >= t.length) return null
  let left = t.slice(0, index).trim()
  let right = t.slice(index).trim()
  left = left.replace(/[,，;；:：…]+\s*$/u, '').replace(/\.{3,}\s*$/u, '').trim()
  if (!left || !right) return null
  return [left, right]
}

function firstWeakSplit(
  text: string
): Array<{ text: string; reason: SemanticSplitReason }> | null {
  const t = text.trim()
  let from = 0
  while (from < t.length) {
    const rel = WEAK_SPLITTERS[0]!.findNext(t, from)
    if (rel < 0) break
    const pair = splitOnceAt(t, rel, 'comma')
    if (pair) {
      return [
        { text: pair[0], reason: 'comma' },
        { text: pair[1], reason: 'comma' }
      ]
    }
    from = rel + 1
  }
  return null
}

function firstRegexSplit(
  text: string,
  re: RegExp,
  reason: SemanticSplitReason
): Array<{ text: string; reason: SemanticSplitReason }> | null {
  const t = text.trim()
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let m: RegExpExecArray | null
  while ((m = r.exec(t)) !== null) {
    const idx = m.index
    const pair = splitOnceAt(t, idx, reason)
    if (pair) {
      return [
        { text: pair[0], reason },
        { text: pair[1], reason }
      ]
    }
  }
  return null
}

function splitLongPiece(text: string, baseReason: SemanticSplitReason): Array<{ text: string; reason: SemanticSplitReason }> {
  const t = text.trim()
  const wc = countWords(t)
  if (wc <= HARD_MAX) return [{ text: t, reason: baseReason }]

  const w = firstWeakSplit(t)
  if (w) {
    return w.flatMap((p) => splitLongPiece(p.text, p.reason))
  }

  const q = firstRegexSplit(t, QUOTE_RE, 'quote')
  if (q) {
    return q.flatMap((p) => splitLongPiece(p.text, p.reason))
  }

  const d = firstRegexSplit(t, DISCOURSE_RE, 'discourse_marker')
  if (d) {
    return d.flatMap((p) => splitLongPiece(p.text, p.reason))
  }

  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 2) return [{ text: t, reason: 'length' }]
  const mid = Math.max(MIN_MERGE_WORDS, Math.floor(words.length / 2))
  const left = words.slice(0, mid).join(' ')
  const right = words.slice(mid).join(' ')
  return [...splitLongPiece(left, 'length'), ...splitLongPiece(right, 'length')]
}

function expandChunks(
  segs: Array<{ text: string; reason: SemanticSplitReason }>,
  lineSource: string
): Array<{ text: string; reason: SemanticSplitReason; lineSource: string }> {
  const out: Array<{ text: string; reason: SemanticSplitReason; lineSource: string }> = []
  for (const s of segs) {
    const parts = splitLongPiece(s.text, s.reason)
    for (const p of parts) {
      out.push({ text: p.text, reason: p.reason, lineSource })
    }
  }
  return out
}

function mergeShortChunks(
  chunks: Array<{ text: string; reason: SemanticSplitReason; lineSource: string }>
): Array<{ text: string; reason: SemanticSplitReason; lineSource: string }> {
  const list = [...chunks]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < list.length; i++) {
      const w = countWords(list[i]!.text)
      if (w >= MIN_MERGE_WORDS) continue
      const cur = list[i]!
      if (
        isQuestionClause(cur.text) ||
        isQuestionTerminated(cur.text) ||
        isShortStandalone(cur.text)
      )
        continue

      if (
        i + 1 < list.length &&
        !isQuestionClause(list[i + 1]!.text) &&
        !isQuestionTerminated(list[i + 1]!.text) &&
        !isShortStandalone(list[i + 1]!.text)
      ) {
        list[i] = {
          text: `${cur.text} ${list[i + 1]!.text}`.replace(/\s+/g, ' ').trim(),
          reason: 'length',
          lineSource: cur.lineSource
        }
        list.splice(i + 1, 1)
        changed = true
        break
      }
      if (
        i > 0 &&
        !isQuestionClause(list[i - 1]!.text) &&
        !isQuestionTerminated(list[i - 1]!.text) &&
        !isShortStandalone(list[i - 1]!.text)
      ) {
        list[i - 1] = {
          text: `${list[i - 1]!.text} ${cur.text}`.replace(/\s+/g, ' ').trim(),
          reason: 'length',
          lineSource: list[i - 1]!.lineSource
        }
        list.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return list
}

function finalizeReason(text: string, reason: SemanticSplitReason, rawBeforeSurface: string): SemanticSplitReason {
  if (isShortStandalone(text) && countWords(text) < MIN_MERGE_WORDS) return 'short_response'
  if (isQuestionClause(text) || isQuestionTerminated(rawBeforeSurface)) return 'question'
  return reason
}

function processLine(line: string): SemanticClause[] {
  const lineTrim = line.trim()
  if (!lineTrim) return []
  const strong = splitStrongSentences(lineTrim)
  const expanded = expandChunks(strong, lineTrim)
  const merged = mergeShortChunks(expanded)
  return merged.map((m) => {
    const raw = m.text.trim()
    const preserveQuestionMark = isQuestionClause(raw)
    const text = preserveQuestionMark ? raw : raw.replace(/[.!?]+$/u, '').trim()
    return {
      id: newId(),
      text,
      sourceText: m.lineSource,
      wordCount: countWords(text),
      charCount: text.length,
      splitReason: finalizeReason(text, m.reason, raw)
    }
  })
}

/**
 * 将一段英文（可多行）切成 semantic clauses。
 * 不处理中文；调用方应仅在英文行上调用。
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
      if (li > 0 && ci === 0) {
        const r = c.splitReason
        if (r !== 'question' && r !== 'short_response') {
          c = { ...c, splitReason: 'line_break' }
        }
      }
      out.push(c)
    }
  }
  return out
}
