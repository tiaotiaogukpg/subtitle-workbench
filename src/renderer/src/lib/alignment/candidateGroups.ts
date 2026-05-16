import type { CandidateSegmentGroup, ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'
import { DEBUG_CANDIDATE_GROUPS_MAX, MAX_GROUP_CHARS, MAX_GROUP_WORDS } from './constants'
import { normalizeGroupText } from './textUtils'

/**
 * 仅生成「单段 = 单组」的参考列表，供调试 / 可视化；
 * 主对齐流程不依赖候选组选择。
 */
export interface BuildDebugCandidateGroupsOptions {
  englishSegments: ScriptSegment[]
  /** 限制 debug 列表长度，避免 prompt 过大；默认 {@link DEBUG_CANDIDATE_GROUPS_MAX}。 */
  maxGroups?: number
  maxWords?: number
  maxChars?: number
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Debug：纯英文池内每个片段单独成组（无 glue、无多段构造）。
 */
export function buildDebugCandidateGroups(
  options: BuildDebugCandidateGroupsOptions
): CandidateSegmentGroup[] {
  const {
    englishSegments: pool,
    maxGroups = DEBUG_CANDIDATE_GROUPS_MAX,
    maxWords = MAX_GROUP_WORDS,
    maxChars = MAX_GROUP_CHARS
  } = options

  const out: CandidateSegmentGroup[] = []
  if (pool.length === 0) return out

  const limit = Math.min(pool.length, Math.max(1, maxGroups))
  for (let i = 0; i < limit; i++) {
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
