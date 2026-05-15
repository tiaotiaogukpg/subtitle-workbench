import type { CandidateSegmentGroup } from '../../types'
import type { AlignmentMatchRow } from './types'

export interface AdvanceEnglishCursorInput {
  previousCursor: number
  acceptedMatches: AlignmentMatchRow[]
  candidateGroups: CandidateSegmentGroup[]
  poolLength: number
}

/** 根据已接受匹配的组 endSegmentIndex 推进；无匹配时保持游标。 */
export function advanceEnglishCursor(input: AdvanceEnglishCursorInput): number {
  const { previousCursor, acceptedMatches, candidateGroups, poolLength } = input
  if (poolLength === 0) return 0

  const groupsById = new Map(candidateGroups.map((g) => [g.id, g]))
  const clamped = Math.min(Math.max(0, previousCursor), Math.max(0, poolLength - 1))
  let maxEnd = -1
  for (const r of acceptedMatches) {
    const g = groupsById.get(r.groupId)
    if (g) maxEnd = Math.max(maxEnd, g.endSegmentIndex)
  }
  if (maxEnd < 0) return clamped
  return Math.min(poolLength, Math.max(clamped, maxEnd + 1))
}
