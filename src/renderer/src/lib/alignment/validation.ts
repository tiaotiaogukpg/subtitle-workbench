import { containsChinese } from '../language'
import type { CandidateSegmentGroup } from '../../types'
import { englishMatchesGroupText } from './candidateGroups'
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
  usedSegmentIdsGlobal?: Set<string>
}

function segmentIdsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function allIdsInGroups(groups: CandidateSegmentGroup[]): Set<string> {
  const s = new Set<string>()
  for (const g of groups) for (const id of g.segmentIds) s.add(id)
  return s
}

function applyDuplicateFlags(
  rows: AlignmentMatchValidated[],
  usedGlobal?: Set<string>
): AlignmentMatchValidated[] {
  let next = rows
  if (usedGlobal?.size) {
    next = next.map((r) => {
      if (r.matchedSegmentIds.some((id) => usedGlobal.has(id))) {
        const flags: AlignmentMatchValidationFlag[] = [
          ...new Set<AlignmentMatchValidationFlag>([...r.validationFlags, 'duplicate_segment'])
        ]
        return { ...r, validationFlags: flags, applyable: computeMatchApplyable(flags) }
      }
      return r
    })
  }
  const counts = new Map<string, number>()
  for (const r of next) {
    for (const id of r.matchedSegmentIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const dup = new Set([...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id))
  if (!dup.size) return next
  return next.map((r) => {
    if (!r.matchedSegmentIds.some((id) => dup.has(id))) return r
    const flags: AlignmentMatchValidationFlag[] = [
      ...new Set<AlignmentMatchValidationFlag>([...r.validationFlags, 'duplicate_segment'])
    ]
    return { ...r, validationFlags: flags, applyable: computeMatchApplyable(flags) }
  })
}

export function validateAlignmentResult(input: ValidateAlignmentResultInput): AlignmentMatchValidated[] {
  const { result, candidateGroups, expectedSubtitleIds, usedSegmentIdsGlobal } = input
  const groupsById = new Map(candidateGroups.map((g) => [g.id, g]))
  const allowedIds = allIdsInGroups(candidateGroups)
  const expected = new Set(expectedSubtitleIds)

  const base = result.map((m) => {
    const flags: AlignmentMatchValidationFlag[] = []
    if (containsChinese(m.english)) flags.push('invalid_candidate')

    const g = groupsById.get(m.groupId)
    if (!g) flags.push('invalid_group_id')
    else {
      if (!segmentIdsEqual(m.matchedSegmentIds, g.segmentIds)) flags.push('invalid_segment_id')
      if (!englishMatchesGroupText(m.english, g.text)) flags.push('english_not_from_group')
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

  return applyDuplicateFlags([...base, ...missingRows], usedSegmentIdsGlobal)
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

export function pickBestApplyablePerSubtitle(
  validated: AlignmentMatchValidated[],
  subtitleId: number
): AlignmentMatchValidated | null {
  const rows = validated.filter((v) => v.subtitleId === subtitleId && v.applyable)
  if (!rows.length) return null
  rows.sort((a, b) => b.confidence - a.confidence)
  return rows[0] ?? null
}
