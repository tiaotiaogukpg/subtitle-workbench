import type { CandidateSegmentGroup } from '../../types'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { getEnglishPoolWindowBounds } from './candidateGroups'
import type { AlignmentMatchValidated, AlignmentMatchValidationFlag } from './types'

export interface AlignmentDriftResult {
  drift: boolean
  reasons: string[]
}

const HARD_BLOCK_FLAGS: AlignmentMatchValidationFlag[] = [
  'invalid_candidate',
  'invalid_segment_id',
  'invalid_group_id',
  'english_not_from_group',
  'missing_subtitle',
  'empty_english'
]

/** 是否通过结构校验（整文件是否写入 english 另见 applyPolicy.isStructuralAIWritable / deriveStatusAfterAI）。 */
export function computeMatchApplyable(flags: AlignmentMatchValidationFlag[]): boolean {
  return !flags.some((f) => HARD_BLOCK_FLAGS.includes(f))
}

function groupsByIdMap(groups: CandidateSegmentGroup[]): Map<string, CandidateSegmentGroup> {
  return new Map(groups.map((g) => [g.id, g]))
}

export function detectAlignmentDrift(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  candidateGroups: CandidateSegmentGroup[],
  englishCursor: number,
  poolLength: number,
  windowSize: number = DEFAULT_GROUP_WINDOW
): AlignmentDriftResult {
  const reasons: string[] = []
  const n = expectedSubtitleIds.length
  if (n === 0) return { drift: false, reasons: [] }
  if (poolLength <= 0 || candidateGroups.length === 0) return { drift: false, reasons: [] }

  const groupsById = groupsByIdMap(candidateGroups)
  const { windowStart, windowEnd } = getEnglishPoolWindowBounds(poolLength, englishCursor, windowSize)

  let missingOrEmpty = 0
  let invalidGroup = 0
  let outsideWindow = 0

  for (const id of expectedSubtitleIds) {
    const r = rows.find((x) => x.subtitleId === id)
    if (!r || r.validationFlags.includes('missing_subtitle') || !r.english.trim()) {
      missingOrEmpty++
      continue
    }
    if (r.validationFlags.includes('invalid_group_id')) {
      invalidGroup++
      continue
    }
    const g = groupsById.get(r.groupId)
    if (g && (g.startSegmentIndex < windowStart || g.endSegmentIndex > windowEnd)) outsideWindow++
  }

  const threshold = Math.max(3, Math.ceil(n * 0.5))
  if (missingOrEmpty >= threshold) {
    reasons.push(`majority subtitles missing model english (${missingOrEmpty}/${n})`)
  }
  if (invalidGroup >= threshold) {
    reasons.push(`majority invalid groupId from model (${invalidGroup}/${n})`)
  }
  if (outsideWindow >= threshold) {
    reasons.push(`majority groups outside cursor transcript window (${outsideWindow}/${n})`)
  }

  return { drift: reasons.length > 0, reasons }
}

export function finalizeBatchAlignment(
  rawValidated: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  candidateGroups: CandidateSegmentGroup[],
  options?: {
    englishCursor?: number
    poolLength?: number
    windowSize?: number
  }
): {
  validated: AlignmentMatchValidated[]
  drift: AlignmentDriftResult
} {
  const rows = rawValidated.map((r) => ({
    ...r,
    applyable: computeMatchApplyable(r.validationFlags)
  }))
  const drift = detectAlignmentDrift(
    rows,
    expectedSubtitleIds,
    candidateGroups,
    options?.englishCursor ?? 0,
    options?.poolLength ?? 0,
    options?.windowSize ?? DEFAULT_GROUP_WINDOW
  )
  return { validated: rows, drift }
}
