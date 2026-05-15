import type { ScriptSegment, SubtitleLine } from '../../types'
import {
  TIME_RATIO_RETRY_COVERAGE_AFTER,
  TIME_RATIO_RETRY_COVERAGE_BEFORE,
  TIME_RATIO_WINDOW_TIER1_AFTER,
  TIME_RATIO_WINDOW_TIER1_BEFORE,
  TIME_RATIO_WINDOW_TIER2_AFTER,
  TIME_RATIO_WINDOW_TIER2_BEFORE
} from './constants'
import {
  buildEnglishContextBlockFromSegmentRange,
  type LocalEnglishContextBlock,
  type TimeRatioContextMeta
} from './englishBlock'

export type ContextWindowTier = 1 | 2 | 3 | 4

export function windowSpecForTier(tier: 1 | 2 | 4): { before: number; after: number } {
  if (tier === 1) {
    return { before: TIME_RATIO_WINDOW_TIER1_BEFORE, after: TIME_RATIO_WINDOW_TIER1_AFTER }
  }
  if (tier === 4) {
    return { before: TIME_RATIO_RETRY_COVERAGE_BEFORE, after: TIME_RATIO_RETRY_COVERAGE_AFTER }
  }
  return { before: TIME_RATIO_WINDOW_TIER2_BEFORE, after: TIME_RATIO_WINDOW_TIER2_AFTER }
}

/** 字幕时间轴：首条 start 至末条 end 的跨度（至少 1ms）。 */
export function computeSubtitleTimeline(subtitles: SubtitleLine[]): {
  timelineStartMs: number
  totalDurationMs: number
} {
  if (subtitles.length === 0) {
    return { timelineStartMs: 0, totalDurationMs: 1 }
  }
  let timelineStartMs = Infinity
  let maxEnd = 0
  for (const s of subtitles) {
    timelineStartMs = Math.min(timelineStartMs, s.start)
    maxEnd = Math.max(maxEnd, s.end)
  }
  if (!Number.isFinite(timelineStartMs)) timelineStartMs = 0
  return {
    timelineStartMs,
    totalDurationMs: Math.max(1, maxEnd - timelineStartMs)
  }
}

export function computeBatchMidRatio(
  batch: SubtitleLine[],
  timelineStartMs: number,
  totalDurationMs: number
): {
  batchStartMs: number
  batchEndMs: number
  batchMidMs: number
  batchMidRatio: number
} {
  const batchStartMs = batch[0]!.start
  const batchEndMs = batch[batch.length - 1]!.end
  const batchMidMs = (batchStartMs + batchEndMs) / 2
  const relMid = batchMidMs - timelineStartMs
  const batchMidRatio = Math.min(1, Math.max(0, relMid / totalDurationMs))
  return { batchStartMs, batchEndMs, batchMidMs, batchMidRatio }
}

export function computeEnglishCenterIndex(batchMidRatio: number, segmentCount: number): number {
  if (segmentCount <= 0) return 0
  if (segmentCount === 1) return 0
  const raw = Math.round(batchMidRatio * segmentCount)
  return Math.min(segmentCount - 1, Math.max(0, raw))
}

/** 含端点的池下标区间 [windowStartSeg, windowEndSeg]。 */
export function computeEnglishWindowSegmentRange(
  centerIndex: number,
  poolLength: number,
  before: number,
  after: number
): { windowStartSeg: number; windowEndSeg: number } {
  if (poolLength <= 0) return { windowStartSeg: 0, windowEndSeg: 0 }
  const windowStartSeg = Math.max(0, centerIndex - before)
  const windowEndSeg = Math.min(poolLength - 1, centerIndex + after)
  return { windowStartSeg, windowEndSeg }
}

/**
 * 按本批字幕在时间轴上的位置比例，独立估算英文池窗口（不依赖上一批对齐结果）。
 */
export function buildTimeRatioEnglishContextBlock(options: {
  englishSegments: ScriptSegment[]
  batch: SubtitleLine[]
  allSubtitles: SubtitleLine[]
  tier: ContextWindowTier
}): LocalEnglishContextBlock | null {
  const pool = options.englishSegments
  if (pool.length === 0) return null

  const { timelineStartMs, totalDurationMs } = computeSubtitleTimeline(options.allSubtitles)
  const { batchStartMs, batchEndMs, batchMidMs, batchMidRatio } = computeBatchMidRatio(
    options.batch,
    timelineStartMs,
    totalDurationMs
  )

  if (options.tier === 3) {
    const end = pool.length - 1
    const meta: TimeRatioContextMeta = {
      batchStartMs,
      batchEndMs,
      batchMidMs,
      totalDurationMs,
      timelineStartMs,
      batchMidRatio,
      englishCenterIndex: computeEnglishCenterIndex(batchMidRatio, pool.length),
      windowStartSeg: 0,
      windowEndSeg: end,
      contextBeforeSegs: 0,
      contextAfterSegs: end,
      windowTier: 3,
      contextCharCount: 0
    }
    const block = buildEnglishContextBlockFromSegmentRange(pool, 0, end, meta)
    if (block) meta.contextCharCount = block.text.length
    return block
  }

  const { before, after } = windowSpecForTier(options.tier as 1 | 2 | 4)
  const center = computeEnglishCenterIndex(batchMidRatio, pool.length)
  const { windowStartSeg, windowEndSeg } = computeEnglishWindowSegmentRange(
    center,
    pool.length,
    before,
    after
  )

  const meta: TimeRatioContextMeta = {
    batchStartMs,
    batchEndMs,
    batchMidMs,
    totalDurationMs,
    timelineStartMs,
    batchMidRatio,
    englishCenterIndex: center,
    windowStartSeg,
    windowEndSeg,
    contextBeforeSegs: before,
    contextAfterSegs: after,
    windowTier: options.tier,
    contextCharCount: 0
  }
  const block = buildEnglishContextBlockFromSegmentRange(pool, windowStartSeg, windowEndSeg, meta)
  if (block) meta.contextCharCount = block.text.length
  return block
}
