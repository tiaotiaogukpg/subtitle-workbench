import type { SubtitleLine } from '../../types'
import { buildGlobalReviewQueue } from './riskModel'

/** 单轮批量重试最多处理的行数（避免 API 轰炸）。 */
export const MAX_BATCH_RETRY_ITEMS_PER_RUN = 50

/**
 * Phase 4B 批量重试目标：与 Coverage Pass 谓词分离，仅用于 Batch Retry UI。
 * 排除 confirmed / manual / manuallyEdited；其余按复查与失败信号纳入。
 */
export function isBatchRetryTarget(line: SubtitleLine): boolean {
  if (line.status === 'confirmed') return false
  if (line.status === 'manual') return false
  if (line.manuallyEdited) return false

  if (line.status === 'needs_review' || line.status === 'unmatched' || line.status === 'low_confidence') {
    return true
  }

  if (!line.english.trim()) return true

  for (const p of line.problems) {
    if (p.includes('ai_alignment:')) return true
  }

  for (const att of line.aiAttempts ?? []) {
    if (!att.english.trim()) return true
    if (
      att.problems.some(
        (x) =>
          x.includes('no_match') ||
          x.includes('ai_alignment:') ||
          x.includes('alignment_request_failed')
      )
    ) {
      return true
    }
  }

  return false
}

/**
 * 按全文件 Review Queue 顺序筛出批量重试 id，并应用条数上限。
 */
export function buildBatchRetryTargetIds(
  subtitles: SubtitleLine[],
  confidenceThresholdPct: number
): { ids: number[]; truncated: boolean; rawCount: number } {
  const queue = buildGlobalReviewQueue(subtitles, { confidenceThresholdPct })
  const ids = queue.filter((e) => isBatchRetryTarget(e.line)).map((e) => e.line.id)
  const rawCount = ids.length
  const truncated = rawCount > MAX_BATCH_RETRY_ITEMS_PER_RUN
  return {
    ids: ids.slice(0, MAX_BATCH_RETRY_ITEMS_PER_RUN),
    truncated,
    rawCount
  }
}
