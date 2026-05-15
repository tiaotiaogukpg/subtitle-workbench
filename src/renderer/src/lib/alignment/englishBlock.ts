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

/** Prompt 中的只读 local English context（不可作为 groupId 直接选用）。 */
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

/**
 * 整篇纯英文稿拼接为单一 English context（无 cursor、无滑动窗口）。
 * 用于 DeepSeek 在全稿上做语义切分与对齐。
 */
export function buildFullFileEnglishContextBlock(englishSegments: ScriptSegment[]): LocalEnglishContextBlock | null {
  const pool = englishSegments
  if (pool.length === 0) return null
  if (pool.some((s) => s.language !== 'english' || !isPureEnglishText(s.text))) return null

  const end = pool.length - 1
  const text = normalizeGroupText(pool.map((s) => s.text.trim()).join(' '))
  const { contextStartGlobalOffset, contextEndGlobalOffset } = computeContextGlobalOffsets(pool, 0, end, text)
  const segmentLocalRanges = computeSegmentLocalRanges(pool, 0, text)

  return {
    segmentIds: pool.map((s) => s.id),
    text,
    startSegmentIndex: 0,
    endSegmentIndex: end,
    segmentCount: pool.length,
    contextStartGlobalOffset,
    contextEndGlobalOffset,
    segmentLocalRanges
  }
}
