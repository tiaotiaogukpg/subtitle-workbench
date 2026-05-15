import type { CandidateMatch, SubtitleStatus } from '../../types'
import { ALIGNMENT_HARD_BLOCK_FLAGS } from './matchFlags'
import { confidenceToPercent, type AlignmentMatchValidated } from './types'

/** 不满足则不能把 DeepSeek 行写入 english。 */
export function isStructuralAIWritable(row: AlignmentMatchValidated): boolean {
  if (!row.english.trim()) return false
  return !row.validationFlags.some((f) => ALIGNMENT_HARD_BLOCK_FLAGS.includes(f))
}

export function pickBestStructuralAIForSubtitle(
  validated: AlignmentMatchValidated[],
  subtitleId: number
): AlignmentMatchValidated | null {
  const rows = validated.filter((r) => r.subtitleId === subtitleId && isStructuralAIWritable(r))
  if (rows.length === 0) return null
  rows.sort((a, b) => b.confidence - a.confidence)
  return rows[0] ?? null
}

/** 无可写入 AI 结果时，生成写入 problems 的诊断 key（供 UI 映射）。 */
export function diagnosticProblemsForFailedAlignment(
  rowsForSubtitle: AlignmentMatchValidated[]
): string[] {
  if (rowsForSubtitle.length === 0) return ['ai_alignment:no_match']
  const best = [...rowsForSubtitle].sort((a, b) => b.confidence - a.confidence)[0]!
  if (isStructuralAIWritable(best)) return ['ai_alignment:no_match']
  const hard = best.validationFlags.find((f) => ALIGNMENT_HARD_BLOCK_FLAGS.includes(f))
  if (hard) return [`ai_alignment:${hard}`]
  return ['ai_alignment:no_match']
}

export function deriveStatusAfterAI(row: AlignmentMatchValidated, thresholdPct: number): SubtitleStatus {
  if (confidenceToPercent(row.confidence) < thresholdPct) {
    return 'low_confidence'
  }
  return 'confirmed'
}

/** 用户可读问题文案（写入 SubtitleLine.problems）。 */
export function readableProblemsForAIRow(row: AlignmentMatchValidated, thresholdPct: number): string[] {
  const out: string[] = []
  if (confidenceToPercent(row.confidence) < thresholdPct) {
    out.push('AI confidence is low.')
  }
  if (row.validationFlags.includes('span_mismatch')) {
    out.push('ai_alignment:span_mismatch')
  }
  if (row.validationFlags.includes('adjacent_span_heavy_overlap')) {
    out.push('ai_alignment:adjacent_span_heavy_overlap')
  }
  return out
}

export const ALIGNMENT_USER_READABLE_MESSAGES = new Set([
  'AI confidence is low.',
  'This line needs manual review.',
  'AI did not return a reliable match.'
])

/** Problems 面板：将历史内部 key 与当前文案统一为可读句。 */
export function formatProblemForDisplay(raw: string): string {
  if (raw.startsWith('ai_alignment:')) {
    switch (raw) {
      case 'ai_alignment:low_confidence':
      case 'ai_alignment:fallback_suggestion':
        return 'This line needs manual review.'
      case 'ai_alignment:alignment_drift':
      case 'ai_alignment:drift_skip_batch':
      case 'ai_alignment:possible_cursor_gap':
        return 'This line needs manual review.'
      case 'ai_alignment:user_skipped_batch':
        return '本批已由用户跳过并标记需复查。'
      case 'ai_alignment:adjacent_span_heavy_overlap':
        return '与相邻行英文区间重叠过多，建议复查。'
      case 'ai_alignment:needs_review':
      case 'ai_alignment:no_match':
      case 'ai_alignment:omitted_by_model':
      case 'ai_alignment:unmatched':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:empty_english':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:invalid_group':
      case 'ai_alignment:invalid_segment':
      case 'ai_alignment:english_mismatch':
      case 'ai_alignment:invalid_candidate':
      case 'ai_alignment:english_not_in_context':
      case 'ai_alignment:non_contiguous_segments':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:duplicate_english_in_batch':
        return '本批存在相同英文文本对应多行，建议复查。'
      case 'ai_alignment:duplicate_span':
        return '本批与其它行英文区间重叠较多，建议复查。'
      case 'ai_alignment:span_mismatch':
        return '模型给出的 span 位置不精确，已按英文原文重新定位。'
      case 'ai_alignment:order_span_violation':
        return '本批英文区间顺序与字幕顺序不完全一致，建议复查。'
      case 'ai_alignment:missing_subtitle':
        return '模型漏返回本行，请人工对齐。'
      case 'ai_alignment:identical_span_reuse':
        return '多行共用同一英文区间，请手动调整。'
      default:
        return '请在本行复查对齐结果。'
    }
  }
  return raw
}

export function validatedRowToCandidate(row: AlignmentMatchValidated): CandidateMatch | null {
  if (!row.english.trim()) return null
  return {
    id: crypto.randomUUID(),
    segmentIds: [...row.matchedSegmentIds],
    text: row.english.trim(),
    confidence: confidenceToPercent(row.confidence),
    groupId: row.groupId || undefined,
    source: 'ai'
  }
}

export function buildCandidatesForSubtitle(
  rowsForSub: AlignmentMatchValidated[],
  primary: AlignmentMatchValidated | null
): CandidateMatch[] {
  const out: CandidateMatch[] = []
  const seen = new Set<string>()

  const push = (c: CandidateMatch | null): void => {
    if (!c) return
    const key = `${c.groupId ?? ''}|${c.text}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  if (primary) {
    push(validatedRowToCandidate(primary))
  }

  const primaryKey = primary ? normalizedEnglishKey(primary.english) : ''
  const aiOthers = [...rowsForSub]
    .filter(
      (r) =>
        isStructuralAIWritable(r) &&
        (!primary || normalizedEnglishKey(r.english) !== primaryKey)
    )
    .sort((a, b) => b.confidence - a.confidence)

  for (const r of aiOthers) {
    push(validatedRowToCandidate(r))
  }

  return out
}

function normalizedEnglishKey(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function isManagedAlignmentProblem(p: string): boolean {
  return p.startsWith('ai_alignment:') || ALIGNMENT_USER_READABLE_MESSAGES.has(p)
}

export function mergeAlignmentProblems(existing: string[], newProblems: string[]): string[] {
  const kept = existing.filter((p) => !isManagedAlignmentProblem(p))
  const merged = [...kept]
  for (const p of newProblems) {
    if (!merged.includes(p)) merged.push(p)
  }
  return merged
}
