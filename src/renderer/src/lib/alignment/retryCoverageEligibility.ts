import type { SubtitleLine } from '../../types'
import { ALIGNMENT_USER_READABLE_MESSAGES } from './applyPolicy'

/** Retry 仍失败时写入 problems 的 key（与 mergeAlignmentProblems / UI 映射一致）。 */
export const AI_ALIGNMENT_NO_MATCH_AFTER_RETRY = 'ai_alignment:no_match_after_retry'

/**
 * 首轮整文件完成后进入 Retry Coverage Pass 的字幕。
 * 不覆盖 confirmed / manual；跳过低置信但已有英文的结果。
 */
export function isRetryCoverageTarget(line: SubtitleLine): boolean {
  if (line.manuallyEdited) return false
  if (line.status === 'confirmed' || line.status === 'manual') return false
  if (line.status === 'low_confidence' && line.english.trim().length > 0) return false

  if (!line.english.trim()) return true
  if (line.status === 'needs_review' || line.status === 'unmatched') return true

  for (const p of line.problems) {
    if (p === 'ai_alignment:user_skipped_batch') continue
    if (p.startsWith('ai_alignment:')) return true
    if (ALIGNMENT_USER_READABLE_MESSAGES.has(p)) return true
  }
  return false
}

/** 按文件顺序返回需 retry 的字幕行。 */
export function collectRetryCoverageTargetsInOrder(subtitles: SubtitleLine[]): SubtitleLine[] {
  return subtitles.filter(isRetryCoverageTarget)
}
