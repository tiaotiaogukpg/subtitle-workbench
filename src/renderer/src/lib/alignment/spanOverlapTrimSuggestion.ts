import { normalizeGroupText } from './textUtils'
import type { AlignmentMatchValidated } from './types'

export interface AdjacentSpanTrimSuggestion {
  subtitleIdEarlier: number
  subtitleIdLater: number
  /** 当前模型给出的英文（较早行） */
  earlierEnglishCurrent: string
  /** 当前模型给出的英文（较晚行） */
  laterEnglishCurrent: string
  /**
   * 建议较早行裁剪为：规范化 context 上 [earlier.spanStart, later.spanStart) 的子串（与校验坐标系一致）。
   * 若无法切片则为 null。
   */
  suggestedEarlierEnglish: string | null
}

function spanOverlapLen(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return Math.max(0, hi - lo)
}

/**
 * 对相邻且 span 重叠的字幕，给出「较早行」英文裁剪建议（不自动写入，仅供 Debug 展示）。
 * `contextPlain` 应与校验使用的 `normalizeGroupText(localEnglishContext.text)` 同源；若仅能提供截断摘录，建议可能不完整。
 */
export function suggestTrimOverlappingAdjacentSpans(
  orderedSubtitleIds: number[],
  rowsBySubtitleId: Map<number, AlignmentMatchValidated>,
  contextPlain: string | null | undefined
): AdjacentSpanTrimSuggestion[] {
  if (!contextPlain?.trim() || orderedSubtitleIds.length < 2) return []
  const ctx = normalizeGroupText(contextPlain)
  const out: AdjacentSpanTrimSuggestion[] = []

  for (let k = 0; k < orderedSubtitleIds.length - 1; k++) {
    const idA = orderedSubtitleIds[k]!
    const idB = orderedSubtitleIds[k + 1]!
    const earlier = rowsBySubtitleId.get(idA)
    const later = rowsBySubtitleId.get(idB)
    if (!earlier || !later) continue
    if (
      earlier.spanStart == null ||
      earlier.spanEnd == null ||
      later.spanStart == null ||
      later.spanEnd == null
    ) {
      continue
    }
    const a0 = earlier.spanStart
    const a1 = earlier.spanEnd
    const b0 = later.spanStart
    const b1 = later.spanEnd
    const olen = spanOverlapLen(a0, a1, b0, b1)
    if (olen <= 0) continue

    let suggested: string | null = null
    if (b0 > a0 && b0 <= a1 && b0 <= ctx.length) {
      suggested = ctx.slice(a0, b0).trimEnd()
      if (!suggested) suggested = null
    }

    out.push({
      subtitleIdEarlier: idA,
      subtitleIdLater: idB,
      earlierEnglishCurrent: earlier.english.trim(),
      laterEnglishCurrent: later.english.trim(),
      suggestedEarlierEnglish: suggested
    })
  }

  return out
}
