import type { LocalEnglishContextBlock, SegmentLocalRange } from './englishBlock'
import type { AlignmentMatchRow } from './types'
import { normalizeGroupText } from './textUtils'
import { ORDER_SPAN_BACKTRACK_TOLERANCE } from './constants'

const CONTEXT_GROUP_ID = 'g_context'

function segmentIdsOverlappingLocalSpan(
  ranges: SegmentLocalRange[],
  spanStart: number,
  spanEnd: number
): string[] {
  const ids: string[] = []
  for (const r of ranges) {
    if (r.end <= spanStart) continue
    if (r.start >= spanEnd) break
    ids.push(r.segmentId)
  }
  return ids
}

function findCaseInsensitiveFrom(haystack: string, needle: string, from: number): number {
  if (!needle) return -1
  const slice = haystack.slice(Math.max(0, from))
  const idx = slice.toLowerCase().indexOf(needle.toLowerCase())
  return idx < 0 ? -1 : Math.max(0, from) + idx
}

function declaredSpanMatchesEnglish(
  ctx: string,
  englishNorm: string,
  spanStart: number | undefined,
  spanEnd: number | undefined
): boolean {
  if (spanStart == null || spanEnd == null) return false
  if (!Number.isInteger(spanStart) || !Number.isInteger(spanEnd)) return false
  if (spanStart < 0 || spanEnd > ctx.length || spanStart >= spanEnd) return false
  return ctx.slice(spanStart, spanEnd).toLowerCase() === englishNorm.toLowerCase()
}

/**
 * 在全稿 English context 上：
 * - 规范化 english；
 * - 若模型 span 与 english 一致则采用，否则自 searchFrom 起做子串定位（不发明英文）；
 * - 按本批字幕顺序推进 searchFrom，保证整体向前；
 * - matchedSegmentIds 仅作元数据（overlap），不作为硬阻断。
 */
export function enrichAlignmentMatchesFromFullContext(
  matches: AlignmentMatchRow[],
  block: LocalEnglishContextBlock,
  orderedSubtitleIds: number[]
): AlignmentMatchRow[] {
  const localRanges = block.segmentLocalRanges
  const ctx = normalizeGroupText(block.text)

  const byId = new Map<number, AlignmentMatchRow>()
  for (const m of matches) {
    if (!byId.has(m.subtitleId)) byId.set(m.subtitleId, m)
  }

  let searchFrom = 0
  const out: AlignmentMatchRow[] = []

  const enrichOne = (m: AlignmentMatchRow): AlignmentMatchRow => {
    const englishNorm = normalizeGroupText(m.english.trim())
    if (!englishNorm) {
      return {
        ...m,
        groupId: m.groupId?.trim() || CONTEXT_GROUP_ID,
        matchedSegmentIds: [],
        english: englishNorm,
        spanStart: undefined,
        spanEnd: undefined,
        globalSpanStart: undefined,
        globalSpanEnd: undefined
      }
    }

    const declS = m.declaredSpanStart ?? m.spanStart
    const declE = m.declaredSpanEnd ?? m.spanEnd
    let start: number | undefined
    let end: number | undefined

    if (declaredSpanMatchesEnglish(ctx, englishNorm, declS, declE)) {
      const lo = Math.max(0, searchFrom - ORDER_SPAN_BACKTRACK_TOLERANCE)
      if (declS! >= lo) {
        start = declS
        end = declE
      }
    }

    if (start == null || end == null) {
      const lo = Math.max(0, searchFrom - ORDER_SPAN_BACKTRACK_TOLERANCE)
      let hit = findCaseInsensitiveFrom(ctx, englishNorm, lo)
      if (hit < 0) hit = findCaseInsensitiveFrom(ctx, englishNorm, 0)
      if (hit >= 0) {
        start = hit
        end = hit + englishNorm.length
      }
    }

    if (start != null && end != null) {
      searchFrom = end
    }

    const matchedSegmentIds =
      start != null && end != null ? segmentIdsOverlappingLocalSpan(localRanges, start, end) : []

    return {
      ...m,
      groupId: m.groupId?.trim() || CONTEXT_GROUP_ID,
      matchedSegmentIds,
      english: englishNorm,
      spanStart: start,
      spanEnd: end,
      globalSpanStart:
        start != null ? block.contextStartGlobalOffset + start : undefined,
      globalSpanEnd: end != null ? block.contextStartGlobalOffset + end : undefined
    }
  }

  for (const sid of orderedSubtitleIds) {
    const m = byId.get(sid)
    if (m) out.push(enrichOne(m))
  }

  for (const m of matches) {
    if (!orderedSubtitleIds.includes(m.subtitleId)) {
      out.push(enrichOne(m))
    }
  }

  return out
}
