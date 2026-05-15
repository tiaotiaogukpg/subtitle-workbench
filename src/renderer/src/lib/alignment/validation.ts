import { containsChinese } from '../language'
import type { CandidateSegmentGroup } from '../../types'
import { englishMatchesGroupText, getEnglishPoolWindowBounds } from './candidateGroups'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { computeMatchApplyable } from './sequentialAlignment'
import type {
  AlignmentMatchRow,
  AlignmentMatchValidated,
  AlignmentMatchValidationFlag
} from './types'

export interface ValidateAlignmentResultInput {
  result: AlignmentMatchRow[]
  candidateGroups: CandidateSegmentGroup[]
  expectedSubtitleIds: number[]
  /** 与 DeepSeek 候选窗口一致时校验 group 是否在池窗口内。 */
  alignmentWindow?: { englishCursor: number; poolLength: number; windowSize?: number }
}

function segmentIdsEqualAsSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((x, i) => x === sb[i])
}

function allIdsInGroups(groups: CandidateSegmentGroup[]): Set<string> {
  const s = new Set<string>()
  for (const g of groups) for (const id of g.segmentIds) s.add(id)
  return s
}

export function validateAlignmentResult(input: ValidateAlignmentResultInput): AlignmentMatchValidated[] {
  const { result, candidateGroups, expectedSubtitleIds, alignmentWindow } = input
  const groupsById = new Map(candidateGroups.map((g) => [g.id, g]))
  const allowedIds = allIdsInGroups(candidateGroups)
  const expected = new Set(expectedSubtitleIds)

  const win =
    alignmentWindow && alignmentWindow.poolLength > 0
      ? getEnglishPoolWindowBounds(
          alignmentWindow.poolLength,
          alignmentWindow.englishCursor,
          alignmentWindow.windowSize ?? DEFAULT_GROUP_WINDOW
        )
      : null

  const base = result.map((m) => {
    const flags: AlignmentMatchValidationFlag[] = []
    if (!m.english.trim()) flags.push('empty_english')
    if (containsChinese(m.english)) flags.push('invalid_candidate')

    const g = groupsById.get(m.groupId)
    if (!g) flags.push('invalid_group_id')
    else {
      if (!segmentIdsEqualAsSet(m.matchedSegmentIds, g.segmentIds)) flags.push('invalid_segment_id')
      if (!englishMatchesGroupText(m.english, g.text)) flags.push('english_not_from_group')
      if (win && (g.startSegmentIndex < win.windowStart || g.endSegmentIndex > win.windowEnd)) {
        flags.push('invalid_group_id')
      }
    }

    if (m.matchedSegmentIds.length === 0) flags.push('invalid_segment_id')
    if (m.matchedSegmentIds.some((id) => !allowedIds.has(id))) flags.push('invalid_segment_id')

    return { ...m, validationFlags: flags, applyable: computeMatchApplyable(flags) }
  })

  const returnedIds = new Set(base.map((r) => r.subtitleId))
  const missingRows: AlignmentMatchValidated[] = []
  for (const id of expected) {
    if (!returnedIds.has(id)) {
      missingRows.push({
        subtitleId: id,
        groupId: '',
        matchedSegmentIds: [],
        english: '',
        confidence: 0,
        reason: '',
        validationFlags: ['missing_subtitle'],
        applyable: false
      })
    }
  }

  return [...base, ...missingRows]
}

export function buildValidationWarnings(validated: AlignmentMatchValidated[]): string[] {
  const w: string[] = []
  validated.forEach((m, i) => {
    for (const flag of m.validationFlags) {
      w.push(`matches[${i}] #${m.subtitleId}: ${flag}`)
    }
  })
  return w
}
