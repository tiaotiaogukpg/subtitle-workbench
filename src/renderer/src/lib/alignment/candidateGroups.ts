import type { CandidateSegmentGroup, ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'
import { MAX_GROUP_CHARS, MAX_GROUP_WORDS } from './constants'
import { normalizeGroupText } from './textUtils'

/**
 * 仅生成「单段 = 单组」的参考列表，供调试 / 可视化；主对齐流程不再依赖候选组选择。
 */
export interface BuildCandidateGroupsOptions {
  englishSegments: ScriptSegment[]
  cursor: number
  windowSize: number
  maxWords?: number
  maxChars?: number
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export { normalizeGroupText } from './textUtils'

export function candidateGroupsById(groups: CandidateSegmentGroup[]): Map<string, CandidateSegmentGroup> {
  return new Map(groups.map((g) => [g.id, g]))
}

/** 与调试候选组窗口一致的英文池下标区间 [windowStart, windowEnd]（含端点）。 */
export function getEnglishPoolWindowBounds(
  poolLength: number,
  cursor: number,
  windowSize: number
): { windowStart: number; windowEnd: number } {
  if (poolLength <= 0) return { windowStart: 0, windowEnd: 0 }
  const windowStart = Math.min(Math.max(0, cursor), poolLength - 1)
  const windowEnd = Math.min(poolLength - 1, cursor + windowSize - 1)
  return { windowStart, windowEnd }
}

/** @deprecated 仅兼容旧名；等价于 {@link buildDebugSingletonCandidateGroups}。 */
export const buildCandidateGroups = buildDebugSingletonCandidateGroups

/**
 * 调试参考：游标窗口内每个英文片段单独成组（无 glue、无多段构造）。
 */
export function buildDebugSingletonCandidateGroups(
  options: BuildCandidateGroupsOptions
): CandidateSegmentGroup[] {
  const {
    englishSegments: pool,
    cursor,
    windowSize,
    maxWords = MAX_GROUP_WORDS,
    maxChars = MAX_GROUP_CHARS
  } = options

  const out: CandidateSegmentGroup[] = []
  if (pool.length === 0 || windowSize <= 0) return out

  const end = Math.min(pool.length - 1, cursor + windowSize - 1)
  const start = Math.min(Math.max(0, cursor), pool.length - 1)

  for (let i = start; i <= end; i++) {
    const seg = pool[i]!
    if (seg.language !== 'english' || !isPureEnglishText(seg.text)) continue
    const text = normalizeGroupText(seg.text.trim())
    const wordCount = countWords(text)
    const charCount = text.length
    if (wordCount > maxWords || charCount > maxChars) continue
    out.push({
      id: `g_${i}_${i}`,
      segmentIds: [seg.id],
      text,
      startSegmentIndex: i,
      endSegmentIndex: i,
      wordCount,
      charCount
    })
  }
  return out
}
