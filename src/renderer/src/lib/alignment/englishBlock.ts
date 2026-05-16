import type { ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'
import { normalizeGroupText } from './textUtils'

/** 某 script segment 在 `LocalEnglishContextBlock.text` 中的 [start,end) 字符区间（与 span 坐标一致）。 */
export interface SegmentLocalRange {
  segmentId: string
  poolIndex: number
  start: number
  end: number
}

/** 时间比例估算窗口的元信息（每批独立时间窗）。 */
export interface TimeRatioContextMeta {
  batchStartMs: number
  batchEndMs: number
  batchMidMs: number
  totalDurationMs: number
  timelineStartMs: number
  batchMidRatio: number
  englishCenterIndex: number
  windowStartSeg: number
  windowEndSeg: number
  contextBeforeSegs: number
  contextAfterSegs: number
  windowTier: 1 | 2 | 3 | 4
  contextCharCount: number
}

/** Prompt 中的只读 English context（整窗原文，供模型在原句内对齐）。 */
export interface LocalEnglishContextBlock {
  segmentIds: string[]
  text: string
  startSegmentIndex: number
  endSegmentIndex: number
  segmentCount: number
  /**
   * `text` 在「整池规范化串联串」中的起始字符下标（与 `spanStart`/`spanEnd` 可加性一致）。
   * 整池串 = normalizeGroupText(pool.map(s => s.text.trim()).join(' '))。
   */
  contextStartGlobalOffset: number
  /** 同上，半开区间终点。 */
  contextEndGlobalOffset: number
  /** 各 segment 在 `text` 内的局部字符区间（与整稿 join+normalize 一致）。 */
  segmentLocalRanges: SegmentLocalRange[]
  /** 本批 context 由字幕时间比例估算时填充；tier 3 = 整稿 retry。 */
  timeRatio?: TimeRatioContextMeta
}

/**
 * 将当前 local window 的规范化文本定位到整池规范化串联串中的 [start,end)，
 * 供 globalStart = contextStartGlobalOffset + localSpanStart 使用。
 * 优先用「前缀长度 + 空格」对齐；失败时在邻域扫描；最后才 indexOf(window)（非 english 重定位）。
 */
export function computeContextGlobalOffsets(
  pool: ScriptSegment[],
  windowStartSeg: number,
  windowEndSeg: number,
  windowNormalizedText: string
): { contextStartGlobalOffset: number; contextEndGlobalOffset: number } {
  const globalText = normalizeGroupText(pool.map((s) => s.text.trim()).join(' '))
  const w = normalizeGroupText(windowNormalizedText)
  if (!w.length || pool.length === 0) {
    return { contextStartGlobalOffset: 0, contextEndGlobalOffset: 0 }
  }

  const prefix =
    windowStartSeg > 0
      ? normalizeGroupText(pool.slice(0, windowStartSeg).map((s) => s.text.trim()).join(' '))
      : ''
  const guesses: number[] = []
  if (windowStartSeg === 0) guesses.push(0)
  else {
    guesses.push(prefix.length + 1)
    guesses.push(prefix.length)
  }
  for (const g of guesses) {
    if (g >= 0 && g + w.length <= globalText.length && globalText.slice(g, g + w.length) === w) {
      return { contextStartGlobalOffset: g, contextEndGlobalOffset: g + w.length }
    }
  }

  const center = prefix.length + (windowStartSeg > 0 ? 1 : 0)
  const scanRadius = 400
  const lo = Math.max(0, center - scanRadius)
  const hi = Math.min(globalText.length - w.length, center + scanRadius)
  for (let i = lo; i <= hi; i++) {
    if (globalText.slice(i, i + w.length) === w) {
      return { contextStartGlobalOffset: i, contextEndGlobalOffset: i + w.length }
    }
  }

  const hit = globalText.indexOf(w)
  if (hit >= 0) {
    return { contextStartGlobalOffset: hit, contextEndGlobalOffset: hit + w.length }
  }

  const fallback = Math.min(Math.max(0, center), Math.max(0, globalText.length - w.length))
  return { contextStartGlobalOffset: fallback, contextEndGlobalOffset: fallback + w.length }
}

function computeSegmentLocalRanges(
  segs: ScriptSegment[],
  blockStartPoolIndex: number,
  fullText: string
): SegmentLocalRange[] {
  const ranges: SegmentLocalRange[] = []
  for (let i = 0; i < segs.length; i++) {
    const joinedBefore = segs.slice(0, i).map((s) => s.text.trim()).join(' ')
    const joinedThrough = segs.slice(0, i + 1).map((s) => s.text.trim()).join(' ')
    const start = i === 0 ? 0 : normalizeGroupText(joinedBefore).length + 1
    const end = normalizeGroupText(joinedThrough).length
    ranges.push({
      segmentId: segs[i]!.id,
      poolIndex: blockStartPoolIndex + i,
      start,
      end
    })
  }
  return ranges
}

/** 从英文池下标区间 [startSeg, endSeg]（含端点）构建 context block。 */
export function buildEnglishContextBlockFromSegmentRange(
  pool: ScriptSegment[],
  startSeg: number,
  endSeg: number,
  timeRatio?: TimeRatioContextMeta
): LocalEnglishContextBlock | null {
  if (pool.length === 0) return null
  const start = Math.min(Math.max(0, startSeg), pool.length - 1)
  const end = Math.min(Math.max(start, endSeg), pool.length - 1)
  const segs = pool.slice(start, end + 1)
  if (segs.some((s) => s.language !== 'english' || !isPureEnglishText(s.text))) return null

  const text = normalizeGroupText(segs.map((s) => s.text.trim()).join(' '))
  const { contextStartGlobalOffset, contextEndGlobalOffset } = computeContextGlobalOffsets(
    pool,
    start,
    end,
    text
  )
  const segmentLocalRanges = computeSegmentLocalRanges(segs, start, text)

  return {
    segmentIds: segs.map((s) => s.id),
    text,
    startSegmentIndex: start,
    endSegmentIndex: end,
    segmentCount: segs.length,
    contextStartGlobalOffset,
    contextEndGlobalOffset,
    segmentLocalRanges,
    timeRatio
  }
}

/** 整稿 context（仅作 tier-3 扩大重试，不作默认）。 */
export function buildFullFileEnglishContextBlock(englishSegments: ScriptSegment[]): LocalEnglishContextBlock | null {
  if (englishSegments.length === 0) return null
  return buildEnglishContextBlockFromSegmentRange(
    englishSegments,
    0,
    englishSegments.length - 1
  )
}
