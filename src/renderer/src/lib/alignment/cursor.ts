import type { ScriptSegment } from '../../types'
import { MAX_ENGLISH_CURSOR_ADVANCE_SEGMENTS } from './constants'
import type { AlignmentMatchRow } from './types'

export interface AdvanceEnglishCursorInput {
  previousCursor: number
  acceptedMatches: AlignmentMatchRow[]
  englishSegments: ScriptSegment[]
  poolLength: number
  /** 单次最多从 previous 向前推进的池下标步长（整文件安全上限）。 */
  maxAdvanceSegments?: number
}

/** 根据已接受匹配的 segment 下标推进；无匹配时保持游标；并限制单次推进幅度。 */
export function advanceEnglishCursor(input: AdvanceEnglishCursorInput): number {
  const { previousCursor, acceptedMatches, englishSegments: pool, poolLength } = input
  if (poolLength === 0) return 0

  const idToIndex = new Map(pool.map((s, i) => [s.id, i]))
  const clamped = Math.min(Math.max(0, previousCursor), Math.max(0, poolLength - 1))
  let maxEnd = -1
  for (const r of acceptedMatches) {
    for (const id of r.matchedSegmentIds) {
      const ix = idToIndex.get(id)
      if (ix != null) maxEnd = Math.max(maxEnd, ix)
    }
  }
  if (maxEnd < 0) return clamped
  const cap = input.maxAdvanceSegments ?? MAX_ENGLISH_CURSOR_ADVANCE_SEGMENTS
  const next = Math.min(poolLength - 1, Math.max(clamped, maxEnd + 1))
  return Math.min(next, clamped + cap)
}
