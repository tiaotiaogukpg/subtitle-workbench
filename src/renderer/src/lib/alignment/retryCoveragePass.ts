import type { ScriptSegment, SubtitleLine } from '../../types'
import { runAlignmentBatchWithTimeRatioTiers } from './smallBatchPipeline'
import type { SmallBatchAlignmentResult } from './smallBatchPipeline'

/**
 * Retry Coverage Pass：更大时间比例窗口（tier 4）→ 仍大量失败则整稿 tier 3。
 * Prompt 使用 `retry_coverage` 分支（system + user note）。
 */
export async function runRetryCoverageAlignmentBatch(input: {
  batch: SubtitleLine[]
  subtitles: SubtitleLine[]
  segments: ScriptSegment[]
  model: string
  confidenceThresholdPct?: number
}): Promise<SmallBatchAlignmentResult> {
  return runAlignmentBatchWithTimeRatioTiers({
    batch: input.batch,
    subtitles: input.subtitles,
    segments: input.segments,
    model: input.model,
    tiers: [4, 3],
    alignmentPass: 'retry_coverage',
    confidenceThresholdPct: input.confidenceThresholdPct
  })
}
