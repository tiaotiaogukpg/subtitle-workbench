import { containsChinese } from '../language'
import type { ScriptSegment } from '../../types'
import type { LocalEnglishContextBlock } from './englishBlock'
import { getEnglishPoolWindowBounds } from './candidateGroups'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { normalizeGroupText } from './textUtils'
import { computeMatchApplyable } from './matchFlags'
import type {
  AlignmentMatchRow,
  AlignmentMatchValidated,
  AlignmentMatchValidationFlag
} from './types'

export interface ValidateAlignmentResultInput {
  result: AlignmentMatchRow[]
  /** 模型须在拼接后的该文本中取连续子串作为 english。 */
  localEnglishContext: LocalEnglishContextBlock | null
  /** 用于 segment id 与连续下标校验的英文池（与游标窗口同源）。 */
  englishPool: ScriptSegment[]
  expectedSubtitleIds: number[]
  alignmentWindow?: { englishCursor: number; poolLength: number; windowSize?: number }
}

function segmentIndexMap(pool: ScriptSegment[]): Map<string, number> {
  return new Map(pool.map((s, i) => [s.id, i]))
}

function areContiguousInPool(pool: ScriptSegment[], ids: string[]): boolean {
  if (ids.length === 0) return false
  const map = segmentIndexMap(pool)
  const idx = ids.map((id) => map.get(id)).filter((x): x is number => x !== undefined)
  if (idx.length !== ids.length) return false
  idx.sort((a, b) => a - b)
  for (let k = 1; k < idx.length; k++) {
    if (idx[k] !== idx[k - 1]! + 1) return false
  }
  return true
}

function normalizedEnglishKey(s: string): string {
  return normalizeGroupText(s).toLowerCase()
}

export function validateAlignmentResult(input: ValidateAlignmentResultInput): AlignmentMatchValidated[] {
  const { result, localEnglishContext, englishPool, expectedSubtitleIds, alignmentWindow } = input
  const expected = new Set(expectedSubtitleIds)
  const ctxText = localEnglishContext ? normalizeGroupText(localEnglishContext.text) : ''
  const allowedIds = new Set(localEnglishContext?.segmentIds ?? [])

  const win =
    alignmentWindow && alignmentWindow.poolLength > 0
      ? getEnglishPoolWindowBounds(
          alignmentWindow.poolLength,
          alignmentWindow.englishCursor,
          alignmentWindow.windowSize ?? DEFAULT_GROUP_WINDOW
        )
      : null

  const dupCounts = new Map<string, number>()
  for (const m of result) {
    const k = normalizedEnglishKey(m.english)
    if (k) dupCounts.set(k, (dupCounts.get(k) ?? 0) + 1)
  }

  const base = result.map((m) => {
    const flags: AlignmentMatchValidationFlag[] = []
    if (!m.english.trim()) flags.push('empty_english')
    if (containsChinese(m.english)) flags.push('invalid_candidate')

    if (!localEnglishContext) {
      flags.push('english_not_in_context')
    } else {
      const ne = normalizeGroupText(m.english)
      if (!ne) flags.push('empty_english')
      else if (!ctxText.toLowerCase().includes(ne.toLowerCase())) {
        flags.push('english_not_in_context')
      }
    }

    if (m.matchedSegmentIds.length === 0) flags.push('invalid_segment_id')
    for (const id of m.matchedSegmentIds) {
      if (!allowedIds.has(id)) flags.push('invalid_segment_id')
    }
    if (m.matchedSegmentIds.length > 0 && !areContiguousInPool(englishPool, m.matchedSegmentIds)) {
      flags.push('non_contiguous_segments')
    }
    if (win) {
      const map = segmentIndexMap(englishPool)
      for (const id of m.matchedSegmentIds) {
        const ix = map.get(id)
        if (ix == null || ix < win.windowStart || ix > win.windowEnd) {
          flags.push('invalid_segment_id')
          break
        }
      }
    }

    const dk = normalizedEnglishKey(m.english)
    if (dk && (dupCounts.get(dk) ?? 0) > 1) flags.push('duplicate_english_in_batch')

    return { ...m, validationFlags: flags, applyable: computeMatchApplyable(flags) }
  })

  const returnedIds = new Set(base.map((r) => r.subtitleId))
  const missingRows: AlignmentMatchValidated[] = []
  for (const id of expected) {
    if (!returnedIds.has(id)) {
      missingRows.push({
        subtitleId: id,
        groupId: '',
        matchedSegmentIds: [],
        english: '',
        confidence: 0,
        reason: '',
        validationFlags: ['missing_subtitle'],
        applyable: false
      })
    }
  }

  return [...base, ...missingRows]
}

export function buildValidationWarnings(validated: AlignmentMatchValidated[]): string[] {
  const w: string[] = []
  validated.forEach((m, i) => {
    for (const flag of m.validationFlags) {
      w.push(`matches[${i}] #${m.subtitleId}: ${flag}`)
    }
  })
  return w
}
