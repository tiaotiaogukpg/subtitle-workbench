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
        return 'Alignment may have drifted.'
      case 'ai_alignment:needs_review':
      case 'ai_alignment:no_match':
      case 'ai_alignment:omitted_by_model':
      case 'ai_alignment:unmatched':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:empty_english':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:drift_skip_batch':
        return '本批因对齐漂移被跳过；请在本批字幕上人工对齐。'
      case 'ai_alignment:invalid_group':
      case 'ai_alignment:invalid_segment':
      case 'ai_alignment:english_mismatch':
      case 'ai_alignment:invalid_candidate':
      case 'ai_alignment:english_not_in_context':
      case 'ai_alignment:non_contiguous_segments':
      case 'ai_alignment:duplicate_english_in_batch':
        return 'AI did not return a reliable match.'
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
