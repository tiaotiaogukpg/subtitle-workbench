import type { SubtitleAiAttempt, SubtitleAiAttemptSource, SubtitleLine, SubtitleStatus } from '../../types'
import { deriveStatusAfterAI, readableProblemsForAIRow } from './applyPolicy'
import type { AlignmentMatchRow, AlignmentMatchValidated } from './types'
import { confidenceToPercent } from './types'

const CJK_RE = /[\u4e00-\u9fff]/

export const MAX_AI_ATTEMPTS_PER_LINE = 48

export function newAiAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `att_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
}

export function normalizeAttemptEnglishKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 从可写入的校验行生成一条尝试快照（不含 id / createdAt）。 */
export function buildAiAttemptPayloadFromWritableRow(
  best: AlignmentMatchValidated,
  options: {
    source: SubtitleAiAttemptSource
    contextTier?: number
    thresholdPct: number
    /** 若传入则覆盖 `readableProblemsForAIRow`（例如与整批合并策略一致时由调用方传入）。 */
    problems?: string[]
  }
): Omit<SubtitleAiAttempt, 'id' | 'createdAt'> {
  const problems = options.problems ?? readableProblemsForAIRow(best, options.thresholdPct)
  const filteredIds = best.matchedSegmentIds
  return {
    source: options.source,
    english: best.english.trim(),
    confidence: confidenceToPercent(best.confidence),
    problems,
    spanStart: best.spanStart,
    spanEnd: best.spanEnd,
    globalSpanStart: best.globalSpanStart,
    globalSpanEnd: best.globalSpanEnd,
    contextTier: options.contextTier,
    reason: best.reason,
    matchedSegmentIds: filteredIds,
    resultStatus: deriveStatusAfterAI(best, options.thresholdPct)
  }
}

/** 失败/空结果：仅记录诊断，不写入英文。 */
export function buildFailedAiAttemptPayload(options: {
  source: SubtitleAiAttemptSource
  problems: string[]
  contextTier?: number
  reason?: string
}): Omit<SubtitleAiAttempt, 'id' | 'createdAt'> {
  return {
    source: options.source,
    english: '',
    confidence: 0,
    problems: options.problems,
    contextTier: options.contextTier,
    reason: options.reason
  }
}

/** 将 `AlignmentMatchRow` 与已知状态写入尝试（用于无 `AlignmentMatchValidated` 的降级路径）。 */
export function buildAiAttemptPayloadFromRowAndStatus(
  row: AlignmentMatchRow,
  options: {
    source: SubtitleAiAttemptSource
    contextTier?: number
    problems: string[]
    resultStatus: SubtitleStatus
  }
): Omit<SubtitleAiAttempt, 'id' | 'createdAt'> {
  return {
    source: options.source,
    english: row.english.trim(),
    confidence: confidenceToPercent(row.confidence),
    problems: options.problems,
    spanStart: row.spanStart,
    spanEnd: row.spanEnd,
    globalSpanStart: row.globalSpanStart,
    globalSpanEnd: row.globalSpanEnd,
    contextTier: options.contextTier,
    reason: row.reason,
    matchedSegmentIds: row.matchedSegmentIds,
    resultStatus: options.resultStatus
  }
}

function intervalOverlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function latestGlobalSpanFromLine(line: SubtitleLine | undefined): { start: number; end: number } | null {
  const attempts = line?.aiAttempts
  if (!attempts?.length) return null
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]!
    if (
      a.globalSpanStart != null &&
      a.globalSpanEnd != null &&
      a.globalSpanEnd > a.globalSpanStart
    ) {
      return { start: a.globalSpanStart, end: a.globalSpanEnd }
    }
  }
  return null
}

function spanOverlapPenalty(
  a: SubtitleAiAttempt,
  prev: { start: number; end: number } | null,
  next: { start: number; end: number } | null
): number {
  if (a.globalSpanStart == null || a.globalSpanEnd == null) return 0
  const len = Math.max(1, a.globalSpanEnd - a.globalSpanStart)
  let pen = 0
  for (const nb of [prev, next]) {
    if (!nb) continue
    const o = intervalOverlapLen(a.globalSpanStart, a.globalSpanEnd, nb.start, nb.end)
    const ratio = o / len
    if (ratio > 0.35) pen += 2
    else if (o > 0) pen += 1
  }
  return pen
}

/**
 * 在多条尝试中推荐「较优」一条：不自动应用。
 * 优先级：非空 → 无中文 → problems 少 → confidence 高 → 与当前 english 不重复 → 全局 span 与邻行重叠惩罚低。
 */
export function suggestBestAttempt(line: SubtitleLine, allLines: SubtitleLine[]): SubtitleAiAttempt | null {
  const attempts = line.aiAttempts
  if (!attempts?.length) return null

  const idx = allLines.findIndex((l) => l.id === line.id)
  const prevLine = idx > 0 ? allLines[idx - 1] : undefined
  const nextLine = idx >= 0 && idx < allLines.length - 1 ? allLines[idx + 1] : undefined
  const prevSpan = latestGlobalSpanFromLine(prevLine)
  const nextSpan = latestGlobalSpanFromLine(nextLine)
  const appliedKey = normalizeAttemptEnglishKey(line.english)

  const pool = attempts.filter((a) => a.english.trim().length > 0 && !CJK_RE.test(a.english))
  if (pool.length === 0) return null

  const sorted = [...pool].sort((a, b) => {
    if (a.problems.length !== b.problems.length) return a.problems.length - b.problems.length
    if (a.confidence !== b.confidence) return b.confidence - a.confidence
    const da = normalizeAttemptEnglishKey(a.english) === appliedKey ? 1 : 0
    const db = normalizeAttemptEnglishKey(b.english) === appliedKey ? 1 : 0
    if (da !== db) return da - db
    const pa = spanOverlapPenalty(a, prevSpan, nextSpan)
    const pb = spanOverlapPenalty(b, prevSpan, nextSpan)
    if (pa !== pb) return pa - pb
    return b.createdAt - a.createdAt
  })
  return sorted[0] ?? null
}

/** 按时间序标记与更早尝试正文相同的项（用于 UI 标 duplicate）。 */
export function markDuplicateAttemptKeys(attempts: SubtitleAiAttempt[]): Map<string, boolean> {
  const dup = new Map<string, boolean>()
  const seen = new Set<string>()
  const chron = [...attempts].sort((a, b) => a.createdAt - b.createdAt)
  for (const a of chron) {
    const k = normalizeAttemptEnglishKey(a.english)
    if (!k) continue
    if (seen.has(k)) dup.set(a.id, true)
    else seen.add(k)
  }
  return dup
}

export function trimAttemptsList(attempts: SubtitleAiAttempt[]): SubtitleAiAttempt[] {
  if (attempts.length <= MAX_AI_ATTEMPTS_PER_LINE) return attempts
  const sorted = [...attempts].sort((a, b) => a.createdAt - b.createdAt)
  return sorted.slice(sorted.length - MAX_AI_ATTEMPTS_PER_LINE)
}

export function resolveStatusWhenApplyingAttempt(
  attempt: SubtitleAiAttempt,
  thresholdPct: number
): SubtitleStatus {
  if (attempt.resultStatus) return attempt.resultStatus
  if (!attempt.english.trim()) return 'needs_review'
  if (attempt.problems.some((p) => p.includes('semantic_undersegmentation'))) return 'needs_review'
  if (attempt.problems.some((p) => p.includes('span_overlap_needs_trim'))) return 'needs_review'
  if (attempt.confidence < thresholdPct) return 'low_confidence'
  return 'confirmed'
}
