import type { CandidateSegmentGroup, ScriptSegment } from '../../types'
import { isPureEnglishText } from '../language'
import { MAX_GROUP_CHARS, MAX_GROUP_SEGMENTS, MAX_GROUP_WORDS } from './constants'

export interface BuildCandidateGroupsOptions {
  englishSegments: ScriptSegment[]
  cursor: number
  windowSize: number
  maxGroupSegments?: number
  maxWords?: number
  maxChars?: number
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

export function normalizeGroupText(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

export function englishMatchesGroupText(modelEnglish: string, groupText: string): boolean {
  const a = normalizeGroupText(modelEnglish)
  const b = normalizeGroupText(groupText)
  if (a === b) return true
  return a.toLowerCase() === b.toLowerCase()
}

export function candidateGroupsById(groups: CandidateSegmentGroup[]): Map<string, CandidateSegmentGroup> {
  return new Map(groups.map((g) => [g.id, g]))
}

/** 与 `buildCandidateGroups` 一致的英文池下标窗口 [windowStart, windowEnd]（含端点）。 */
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

export function buildCandidateGroups(options: BuildCandidateGroupsOptions): CandidateSegmentGroup[] {
  const {
    englishSegments: pool,
    cursor,
    windowSize,
    maxGroupSegments = MAX_GROUP_SEGMENTS,
    maxWords = MAX_GROUP_WORDS,
    maxChars = MAX_GROUP_CHARS
  } = options

  const out: CandidateSegmentGroup[] = []
  if (pool.length === 0 || windowSize <= 0) return out

  const end = Math.min(pool.length - 1, cursor + windowSize - 1)
  const start = Math.min(Math.max(0, cursor), pool.length - 1)
  const sliceLen = end - start + 1
  if (sliceLen <= 0) return out

  for (let i = 0; i < sliceLen; i++) {
    const absStart = start + i
    for (let run = 1; run <= maxGroupSegments && absStart + run - 1 <= end; run++) {
      const segs = pool.slice(absStart, absStart + run)
      if (segs.some((s) => s.language !== 'english' || !isPureEnglishText(s.text))) continue
      const segmentIds = segs.map((s) => s.id)
      const text = normalizeGroupText(segs.map((s) => s.text.trim()).join(' '))
      const wordCount = countWords(text)
      const charCount = text.length
      if (wordCount > maxWords || charCount > maxChars) continue
      const endIdx = absStart + run - 1
      out.push({
        id: `g_${absStart}_${endIdx}`,
        segmentIds,
        text,
        startSegmentIndex: absStart,
        endSegmentIndex: endIdx,
        wordCount,
        charCount
      })
    }
  }
  return out
}
