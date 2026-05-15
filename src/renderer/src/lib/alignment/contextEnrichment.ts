import type { ScriptSegment } from '../../types'
import type { LocalEnglishContextBlock } from './englishBlock'
import type { AlignmentMatchRow } from './types'
import { normalizeGroupText } from './textUtils'

const CONTEXT_GROUP_ID = 'g_context'

function charRangesForSegments(
  segs: ScriptSegment[],
  basePoolIndex: number
): Array<{ id: string; poolIndex: number; start: number; end: number }> {
  const out: Array<{ id: string; poolIndex: number; start: number; end: number }> = []
  let pos = 0
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!
    const t = normalizeGroupText(seg.text)
    if (i > 0) pos += 1
    const start = pos
    const end = pos + t.length
    pos = end
    out.push({ id: seg.id, poolIndex: basePoolIndex + i, start, end })
  }
  return out
}

function findNormalizedSpan(haystack: string, needle: string): { start: number; end: number } | null {
  const h = normalizeGroupText(haystack).toLowerCase()
  const n = normalizeGroupText(needle).toLowerCase()
  if (!n) return null
  const i = h.indexOf(n)
  if (i < 0) return null
  return { start: i, end: i + n.length }
}

function segmentIdsCoveringSpan(
  ranges: Array<{ id: string; poolIndex: number; start: number; end: number }>,
  spanStart: number,
  spanEnd: number
): string[] {
  const ids: string[] = []
  for (const r of ranges) {
    if (r.end <= spanStart) continue
    if (r.start >= spanEnd) break
    ids.push(r.id)
  }
  return ids
}

/**
 * 将模型返回的 english 与 local context 对齐：补全 groupId、按子串位置推断 matchedSegmentIds。
 */
export function enrichAlignmentMatchesFromLocalContext(
  matches: AlignmentMatchRow[],
  block: LocalEnglishContextBlock,
  pool: ScriptSegment[]
): AlignmentMatchRow[] {
  const segs = pool.slice(block.startSegmentIndex, block.endSegmentIndex + 1)
  const ranges = charRangesForSegments(segs, block.startSegmentIndex)
  const ctx = normalizeGroupText(block.text)

  return matches.map((m) => {
    const english = m.english.trim()
    const span = findNormalizedSpan(ctx, english)
    const matchedSegmentIds = span
      ? segmentIdsCoveringSpan(ranges, span.start, span.end)
      : [...m.matchedSegmentIds]
    return {
      ...m,
      groupId: m.groupId?.trim() || CONTEXT_GROUP_ID,
      matchedSegmentIds,
      english
    }
  })
}
