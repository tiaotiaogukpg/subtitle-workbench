import type { ScriptSegment, ScriptSegmentLanguage } from '../types'

/** 单行原文的粗分类（含版式/角色行）。 */
export type LineLanguageKind = 'english' | 'chinese' | 'mixed' | 'empty' | 'speaker' | 'unknown'

function countCjk(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff)) n++
  }
  return n
}

function countLatinLetters(s: string): number {
  return (s.match(/[a-zA-Z]/g) ?? []).length
}

function hasHanScript(s: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(s)
}

/** ASCII 或全角数字（无汉字时可用于英文稿/时间码等，与拉丁字母同属对齐用「西文」类）。 */
function hasDigitLike(s: string): boolean {
  return /[0-9\uFF10-\uFF19]/.test(s)
}

/**
 * 说话人 / 小节标题行：整行在冒号后无正文（仅空白或引号括号收尾）。
 * 排除常见时间码 `00:00`、URL。
 */
export function isSpeakerLine(line: string): boolean {
  const s = line.trim()
  if (s.length === 0 || s.length > 100) return false
  if (/https?:\/\//i.test(s)) return false
  if (/^\d{1,2}:\d{2}(?::\d{2})?\b/.test(s)) return false
  if (!/[:：]/.test(s)) return false
  const m = s.match(/^(.{1,80})([:：])([\s「」【】（）()'"'‘’]*)$/u)
  if (!m) return false
  const before = m[1].trim()
  if (before.length === 0) return false
  return true
}

export function detectLineLanguageKind(line: string): LineLanguageKind {
  const s = line.replace(/\uFEFF/g, '')
  if (s.trim() === '') return 'empty'
  const t = s.trim()
  if (isSpeakerLine(t)) return 'speaker'

  const cjk = countCjk(t)
  const lat = countLatinLetters(t)

  if (cjk > 0 && lat > 0) return 'mixed'
  if (cjk > 0) return 'chinese'
  if (lat > 0) return 'english'
  if (hasDigitLike(t) && !hasHanScript(t)) return 'english'
  return 'unknown'
}

/** 英文句切分：`. ! ?` 后接空白。 */
export function splitEnglishSentences(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  const parts = t.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [t]
}

const ENGLISH_CLAUSE_BREAK =
  /(?<=[,;])\s+|(?<=\s)(?:and|but|so|because|then|or|yet|while|when)\s+(?=[a-z"'(])/gi

const ENGLISH_PAUSE_BREAK = /\s+—\s+|\s+–\s+|\s*\.\.\.\s+/g

const ENGLISH_MAX_CLAUSE_WORDS = 18

function splitByMaxWords(clause: string, maxWords: number): string[] {
  const words = clause.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return [clause.trim()]
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '))
  }
  return chunks.filter(Boolean)
}

function splitEnglishClauses(sentence: string): string[] {
  let parts = [sentence.trim()].filter(Boolean)
  for (const re of [ENGLISH_PAUSE_BREAK]) {
    parts = parts.flatMap((p) => p.split(re).map((x) => x.trim()).filter(Boolean))
  }
  parts = parts.flatMap((p) => {
    const sub = p.split(ENGLISH_CLAUSE_BREAK).map((s) => s.trim()).filter(Boolean)
    return sub.length > 0 ? sub : [p]
  })
  return parts.flatMap((p) => splitByMaxWords(p, ENGLISH_MAX_CLAUSE_WORDS))
}

/**
 * 英文细粒度切分：句末 → 子句（逗号/连接词/停顿）→ 过长分块。
 * 便于连续字幕对齐到细粒度 segment 流。
 */
export function splitEnglishSegments(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const paragraphs = lines.length > 0 ? lines : [t]
  const out: string[] = []
  for (const para of paragraphs) {
    for (const sent of splitEnglishSentences(para)) {
      out.push(...splitEnglishClauses(sent))
    }
  }
  return out.length > 0 ? out : [t]
}

/** 中文句切分：`。！？` 后可无空格。 */
export function splitChineseSentences(text: string): string[] {
  const t = text.trim()
  if (!t) return []
  const parts = t.split(/(?<=[。！？])\s*/).map((p) => p.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [t]
}

function defaultUsedForLanguage(lang: ScriptSegmentLanguage): boolean {
  return lang === 'english' || lang === 'mixed'
}

function newSegment(
  text: string,
  language: ScriptSegmentLanguage,
  sourceLine: number,
  used?: boolean
): ScriptSegment {
  const u = used ?? defaultUsedForLanguage(language)
  return {
    id: crypto.randomUUID(),
    text,
    language,
    sourceLine,
    used: u
  }
}

/**
 * 混合采访稿 / 中英混排 txt → `ScriptSegment[]`。
 * - 空行不产生 segment。
 * - `speaker` → `language: unknown`，`used: false`。
 * - `mixed` 整行一条，不切句。
 * - `english` / `chinese` 在单行内按各自句末标点切分；子句共享同一 `sourceLine`。
 */
export function parseMixedTranscript(raw: string): ScriptSegment[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const out: ScriptSegment[] = []

  for (let i = 0; i < lines.length; i++) {
    const sourceLine = i + 1
    const rawLine = lines[i] ?? ''
    const trimmed = rawLine.trim()
    if (trimmed === '') continue

    const kind = detectLineLanguageKind(rawLine)

    if (kind === 'speaker') {
      out.push(newSegment(trimmed, 'unknown', sourceLine, false))
      continue
    }

    if (kind === 'mixed') {
      out.push(newSegment(trimmed, 'mixed', sourceLine, true))
      continue
    }

    if (kind === 'english') {
      for (const piece of splitEnglishSegments(trimmed)) {
        out.push(newSegment(piece, 'english', sourceLine, true))
      }
      continue
    }

    if (kind === 'chinese') {
      for (const piece of splitChineseSentences(trimmed)) {
        out.push(newSegment(piece, 'chinese', sourceLine, false))
      }
      continue
    }

    out.push(newSegment(trimmed, 'unknown', sourceLine, false))
  }

  return out
}
