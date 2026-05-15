import type { CandidateMatch, CandidateSegmentGroup, SubtitleStatus } from '../../types'
import { candidateGroupsById, getEnglishPoolWindowBounds } from './candidateGroups'
import { DEFAULT_GROUP_WINDOW } from './constants'
import type { AlignmentMatchValidated, AlignmentMatchValidationFlag } from './types'
import { confidenceToPercent } from './types'

/** 批内首条字幕允许的最大英文池起点偏移（相对 englishCursor）。 */
export const BATCH_START_MAX_SEGMENT_OFFSET = 2

/** 不满足则不能把 DeepSeek 行写入 english（但仍可走 fallback 候选）。 */
const STRUCTURAL_NO_WRITE_FLAGS: AlignmentMatchValidationFlag[] = [
  'missing_subtitle',
  'sequential_fallback',
  'invalid_candidate',
  'invalid_segment_id',
  'invalid_group_id',
  'english_not_from_group',
  'duplicate_segment',
  'empty_english'
]

export function isStructuralAIWritable(
  row: AlignmentMatchValidated,
  candidateGroups: CandidateSegmentGroup[],
  cursor: number,
  poolLength: number,
  windowSize: number = DEFAULT_GROUP_WINDOW
): boolean {
  if (!row.groupId || !row.english.trim()) return false
  if (row.validationFlags.some((f) => STRUCTURAL_NO_WRITE_FLAGS.includes(f))) return false
  const g = candidateGroupsById(candidateGroups).get(row.groupId)
  if (!g) return false
  const { windowStart, windowEnd } = getEnglishPoolWindowBounds(poolLength, cursor, windowSize)
  if (g.startSegmentIndex < windowStart || g.endSegmentIndex > windowEnd) return false
  return true
}

export function pickBestStructuralAIForSubtitle(
  validated: AlignmentMatchValidated[],
  subtitleId: number,
  candidateGroups: CandidateSegmentGroup[],
  cursor: number,
  poolLength: number,
  windowSize: number = DEFAULT_GROUP_WINDOW
): AlignmentMatchValidated | null {
  const rows = validated.filter(
    (r) =>
      r.subtitleId === subtitleId &&
      isStructuralAIWritable(r, candidateGroups, cursor, poolLength, windowSize)
  )
  if (rows.length === 0) return null
  rows.sort((a, b) => b.confidence - a.confidence)
  return rows[0] ?? null
}

export function deriveStatusAfterAI(
  row: AlignmentMatchValidated,
  thresholdPct: number
): SubtitleStatus {
  if (
    row.validationFlags.includes('alignment_drift') ||
    row.validationFlags.includes('segment_jump') ||
    row.validationFlags.includes('segment_backward')
  ) {
    return 'needs_review'
  }
  if (confidenceToPercent(row.confidence) < thresholdPct) {
    return 'low_confidence'
  }
  return 'confirmed'
}

/** 用户可读问题文案（写入 SubtitleLine.problems）。 */
export function readableProblemsForAIRow(
  row: AlignmentMatchValidated,
  thresholdPct: number
): string[] {
  const out: string[] = []
  if (confidenceToPercent(row.confidence) < thresholdPct) {
    out.push('AI confidence is low.')
  }
  if (row.validationFlags.includes('alignment_drift')) {
    out.push('Alignment may have drifted.')
  }
  if (
    row.validationFlags.includes('segment_jump') ||
    row.validationFlags.includes('segment_backward')
  ) {
    out.push('Alignment may have jumped in the transcript; listen back and edit if needed.')
  }
  if (row.validationFlags.includes('duplicate_segment')) {
    out.push('Segment reuse conflict; please pick a candidate manually.')
  }
  return out
}

export const ALIGNMENT_USER_READABLE_MESSAGES = new Set([
  'AI confidence is low.',
  'Alignment may have drifted.',
  'Alignment may have jumped in the transcript; listen back and edit if needed.',
  'Segment reuse conflict; please pick a candidate manually.',
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
      case 'ai_alignment:segment_jump':
      case 'ai_alignment:segment_backward':
        return 'Alignment may have jumped in the transcript; listen back and edit if needed.'
      case 'ai_alignment:needs_review':
      case 'ai_alignment:no_match':
      case 'ai_alignment:omitted_by_model':
      case 'ai_alignment:unmatched':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:empty_english':
        return 'AI did not return a reliable match.'
      case 'ai_alignment:duplicate_segment':
        return 'Segment reuse conflict; please pick a candidate manually.'
      case 'ai_alignment:invalid_group':
      case 'ai_alignment:invalid_segment':
      case 'ai_alignment:english_mismatch':
      case 'ai_alignment:invalid_candidate':
        return 'AI did not return a reliable match.'
      default:
        return 'This line needs manual review.'
    }
  }
  return raw
}

export function validatedRowToCandidate(
  row: AlignmentMatchValidated,
  source: 'ai' | 'fallback'
): CandidateMatch | null {
  if (!row.english.trim()) return null
  return {
    id: crypto.randomUUID(),
    segmentIds: [...row.matchedSegmentIds],
    text: row.english.trim(),
    confidence: confidenceToPercent(row.confidence),
    groupId: row.groupId || undefined,
    source
  }
}

export function buildCandidatesForSubtitle(
  rowsForSub: AlignmentMatchValidated[],
  primary: AlignmentMatchValidated | null,
  candidateGroups: CandidateSegmentGroup[],
  cursor: number,
  poolLength: number,
  windowSize: number = DEFAULT_GROUP_WINDOW
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
    push(validatedRowToCandidate(primary, 'ai'))
  }

  const aiOthers = [...rowsForSub]
    .filter(
      (r) =>
        isStructuralAIWritable(r, candidateGroups, cursor, poolLength, windowSize) &&
        (!primary || r.groupId !== primary.groupId)
    )
    .sort((a, b) => b.confidence - a.confidence)

  for (const r of aiOthers) {
    push(validatedRowToCandidate(r, 'ai'))
  }

  for (const r of rowsForSub) {
    if (r.validationFlags.includes('sequential_fallback')) {
      push(validatedRowToCandidate(r, 'fallback'))
    }
  }

  return out
}

export function isManagedAlignmentProblem(p: string): boolean {
  return p.startsWith('ai_alignment:') || ALIGNMENT_USER_READABLE_MESSAGES.has(p)
}

export function mergeAlignmentProblems(
  existing: string[],
  newProblems: string[]
): string[] {
  const kept = existing.filter((p) => !isManagedAlignmentProblem(p))
  const merged = [...kept]
  for (const p of newProblems) {
    if (!merged.includes(p)) merged.push(p)
  }
  return merged
}
