import { ALIGNMENT_USER_READABLE_MESSAGES } from './applyPolicy'
import type { ScriptSegment, SubtitleLine } from '../../types'
import { filterEnglishPoolSegments } from './englishPool'
import type { AlignmentDriftResult } from './sequentialAlignment'
import type { AlignmentMatchValidated } from './types'

/** 整文件对齐完成后的汇总报告。 */
export interface FullFileAlignmentReport {
  totalSubtitleCount: number
  matchedSubtitleCount: number
  needsReviewCount: number
  unmatchedCount: number
  lowConfidenceCount: number
  unusedEnglishSegmentIds: string[]
  duplicateSegmentIds: string[]
}

export interface AlignmentReport {
  batchSubtitleCount: number
  matchedSubtitleCount: number
  missingSubtitleIds: number[]
  /** 批内窗口中同一 segment 被多行可应用结果使用的次数（仅统计，不阻断对齐）。 */
  duplicateSegmentIds: string[]
  unusedSegmentIdsInWindow: string[]
  validationWarningCount: number
  /** 模型返回但校验未通过（不含 missing_subtitle 占位行）。 */
  invalidResultCount: number
  /** 可应用且置信度低于阈值。 */
  lowConfidenceCount: number
  /** 缺失 + 无效，需人工复查。 */
  needsReviewCount: number
  alignmentDrift: boolean
  alignmentDriftReasons: string[]
}

export function checkSubtitleCompleteness(
  expectedSubtitleIds: number[],
  validated: AlignmentMatchValidated[]
): { complete: boolean; missingSubtitleIds: number[] } {
  const matched = new Set(
    validated.filter((v) => v.applyable).map((v) => v.subtitleId)
  )
  const missingSubtitleIds = expectedSubtitleIds.filter((id) => !matched.has(id))
  return { complete: missingSubtitleIds.length === 0, missingSubtitleIds }
}

export function checkEnglishSegmentUsage(
  scopeSegmentIds: string[],
  validated: AlignmentMatchValidated[]
): { duplicateSegmentIds: string[]; unusedSegmentIdsInWindow: string[] } {
  const windowIds = new Set(scopeSegmentIds)
  const counts = new Map<string, number>()
  for (const v of validated) {
    if (!v.applyable) continue
    for (const id of v.matchedSegmentIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const duplicateSegmentIds = [...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id)
  const used = new Set([...counts.keys()])
  const unusedSegmentIdsInWindow = [...windowIds].filter((id) => !used.has(id))
  return { duplicateSegmentIds, unusedSegmentIdsInWindow }
}

export function buildAlignmentReport(
  expectedSubtitleIds: number[],
  validated: AlignmentMatchValidated[],
  scopeSegmentIds: string[],
  options?: { confidenceThresholdPct?: number; drift?: AlignmentDriftResult }
): AlignmentReport {
  const { missingSubtitleIds } = checkSubtitleCompleteness(expectedSubtitleIds, validated)
  const { duplicateSegmentIds, unusedSegmentIdsInWindow } = checkEnglishSegmentUsage(
    scopeSegmentIds,
    validated
  )
  const applyable = validated.filter((v) => v.applyable)
  const matchedSubtitleCount = applyable.length
  const validationWarningCount = validated.reduce((n, v) => n + v.validationFlags.length, 0)
  const invalidResultCount = validated.filter(
    (v) => !v.applyable && !v.validationFlags.includes('missing_subtitle')
  ).length
  const threshold = options?.confidenceThresholdPct ?? 60
  const lowConfidenceCount = applyable.filter((v) => {
    const pct = v.confidence > 0 && v.confidence <= 1 ? v.confidence * 100 : v.confidence
    return pct < threshold
  }).length
  const needsReviewCount = missingSubtitleIds.length + invalidResultCount

  return {
    batchSubtitleCount: expectedSubtitleIds.length,
    matchedSubtitleCount,
    missingSubtitleIds,
    duplicateSegmentIds,
    unusedSegmentIdsInWindow,
    validationWarningCount,
    invalidResultCount,
    lowConfidenceCount,
    needsReviewCount,
    alignmentDrift: options?.drift?.drift ?? false,
    alignmentDriftReasons: options?.drift?.reasons ?? []
  }
}

export function buildFullFileAlignmentReport(input: {
  subtitles: SubtitleLine[]
  segments: ScriptSegment[]
  duplicateSegmentIds: string[]
}): FullFileAlignmentReport {
  const { subtitles, segments, duplicateSegmentIds } = input
  let matchedSubtitleCount = 0
  let needsReviewCount = 0
  let unmatchedCount = 0
  let lowConfidenceCount = 0

  for (const line of subtitles) {
    const hasEnglish = line.english.trim().length > 0
    if (hasEnglish) matchedSubtitleCount++
    if (line.status === 'unmatched') unmatchedCount++
    if (line.status === 'low_confidence') lowConfidenceCount++
    if (
      line.status === 'needs_review' ||
      line.status === 'low_confidence' ||
      line.problems.some((p) => p.startsWith('ai_alignment:') || ALIGNMENT_USER_READABLE_MESSAGES.has(p))
    ) {
      needsReviewCount++
    }
  }

  const unusedEnglishSegmentIds = filterEnglishPoolSegments(segments)
    .filter((s) => !s.used)
    .map((s) => s.id)

  return {
    totalSubtitleCount: subtitles.length,
    matchedSubtitleCount,
    needsReviewCount,
    unmatchedCount,
    lowConfidenceCount,
    unusedEnglishSegmentIds,
    duplicateSegmentIds
  }
}
