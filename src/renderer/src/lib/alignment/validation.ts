import { containsChinese } from '../language'
import type { LocalEnglishContextBlock } from './englishBlock'
import {
  ADJACENT_SPAN_OVERLAP_RATIO,
  ORDER_SPAN_BACKTRACK_TOLERANCE,
  SPAN_OVERLAP_DUPLICATE_RATIO
} from './constants'
import { normalizeGroupText } from './textUtils'
import { computeMatchApplyable } from './matchFlags'
import type {
  AlignmentMatchRow,
  AlignmentMatchValidated,
  AlignmentMatchValidationFlag
} from './types'

export interface ValidateAlignmentResultInput {
  result: AlignmentMatchRow[]
  /** 本批 DeepSeek 使用的整稿 English context（规范化文本）。 */
  localEnglishContext: LocalEnglishContextBlock | null
  expectedSubtitleIds: number[]
}

function normalizedEnglishKey(s: string): string {
  return normalizeGroupText(s).toLowerCase()
}

function spanKey(s: number, e: number): string {
  return `${s}:${e}`
}

function spanOverlapLen(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return Math.max(0, hi - lo)
}

function rowSpanEligible(m: AlignmentMatchValidated): boolean {
  if (m.validationFlags.includes('missing_subtitle')) return false
  if (m.validationFlags.includes('empty_english')) return false
  if (m.validationFlags.includes('english_not_in_context')) return false
  if (m.spanStart == null || m.spanEnd == null) return false
  if (!Number.isInteger(m.spanStart) || !Number.isInteger(m.spanEnd)) return false
  return m.spanStart < m.spanEnd
}

function addFlag(
  map: Map<number, Set<AlignmentMatchValidationFlag>>,
  subtitleId: number,
  flag: AlignmentMatchValidationFlag
): void {
  if (!map.has(subtitleId)) map.set(subtitleId, new Set())
  map.get(subtitleId)!.add(flag)
}

/** 供调试面板：根据已解析的 span 粗查批内重叠（与校验阈值一致）。 */
export function buildSpanPairDiagnostics(rows: AlignmentMatchValidated[]): string[] {
  const eligible = rows.filter(rowSpanEligible)
  const notes: string[] = []
  for (let i = 0; i < eligible.length; i++) {
    const a = eligible[i]!
    const a0 = a.spanStart!
    const a1 = a.spanEnd!
    for (let j = i + 1; j < eligible.length; j++) {
      const b = eligible[j]!
      const b0 = b.spanStart!
      const b1 = b.spanEnd!
      if (a0 === b0 && a1 === b1) {
        notes.push(`identical_span #${a.subtitleId} ≅ #${b.subtitleId} [${a0},${a1})`)
        continue
      }
      const olen = spanOverlapLen(a0, a1, b0, b1)
      const minLen = Math.min(a1 - a0, b1 - b0)
      if (minLen > 0 && olen / minLen >= SPAN_OVERLAP_DUPLICATE_RATIO) {
        notes.push(
          `heavy_overlap #${a.subtitleId} vs #${b.subtitleId} (${Math.round((100 * olen) / minLen)}% of shorter span)`
        )
      }
    }
  }
  return notes
}

export function buildSpanOrderDiagnostics(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[]
): string[] {
  const byId = new Map(rows.map((r) => [r.subtitleId, r]))
  const notes: string[] = []
  for (let k = 1; k < expectedSubtitleIds.length; k++) {
    const prevId = expectedSubtitleIds[k - 1]!
    const curId = expectedSubtitleIds[k]!
    const earlier = byId.get(prevId)
    const later = byId.get(curId)
    if (!earlier || !later) continue
    if (!rowSpanEligible(earlier) || !rowSpanEligible(later)) continue
    if (later.spanStart! < earlier.spanStart! - ORDER_SPAN_BACKTRACK_TOLERANCE) {
      notes.push(
        `order_span #${prevId}[${earlier.spanStart},${earlier.spanEnd}) → #${curId}[${later.spanStart},${later.spanEnd}) backtracks`
      )
    }
  }
  return notes
}

export function validateAlignmentResult(input: ValidateAlignmentResultInput): AlignmentMatchValidated[] {
  const { result, localEnglishContext, expectedSubtitleIds } = input
  const expected = new Set(expectedSubtitleIds)
  const ctxText = localEnglishContext ? normalizeGroupText(localEnglishContext.text) : ''

  const dupCounts = new Map<string, number>()
  for (const m of result) {
    const k = normalizedEnglishKey(m.english)
    if (k) dupCounts.set(k, (dupCounts.get(k) ?? 0) + 1)
  }

  const base = result.map((m) => {
    const flags: AlignmentMatchValidationFlag[] = []
    if (!m.english.trim()) flags.push('empty_english')
    if (containsChinese(m.english)) flags.push('invalid_candidate')

    const englishNorm = normalizeGroupText(m.english)

    if (!localEnglishContext) {
      flags.push('english_not_in_context')
    } else {
      if (!englishNorm) flags.push('empty_english')
      else if (!ctxText.toLowerCase().includes(englishNorm.toLowerCase())) {
        flags.push('english_not_in_context')
      }
    }

    if (
      m.spanStart != null &&
      m.spanEnd != null &&
      Number.isInteger(m.spanStart) &&
      Number.isInteger(m.spanEnd) &&
      m.spanStart >= 0 &&
      m.spanEnd <= ctxText.length &&
      m.spanStart < m.spanEnd &&
      englishNorm
    ) {
      const localSlice = ctxText.slice(m.spanStart, m.spanEnd)
      if (localSlice.toLowerCase() !== englishNorm.toLowerCase()) {
        flags.push('span_mismatch')
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

  const mergedPre = [...base, ...missingRows]
  const batchExtra = new Map<number, Set<AlignmentMatchValidationFlag>>()

  const spanRows = mergedPre.filter(rowSpanEligible)
  const keyToIds = new Map<string, number[]>()
  for (const r of spanRows) {
    const k = spanKey(r.spanStart!, r.spanEnd!)
    const arr = keyToIds.get(k) ?? []
    arr.push(r.subtitleId)
    keyToIds.set(k, arr)
  }
  for (const ids of keyToIds.values()) {
    if (ids.length <= 1) continue
    const uniq = [...new Set(ids)]
    for (const id of uniq) addFlag(batchExtra, id, 'identical_span_reuse')
  }

  for (let i = 0; i < spanRows.length; i++) {
    const a = spanRows[i]!
    const a0 = a.spanStart!
    const a1 = a.spanEnd!
    for (let j = i + 1; j < spanRows.length; j++) {
      const b = spanRows[j]!
      if (a.subtitleId === b.subtitleId) continue
      const b0 = b.spanStart!
      const b1 = b.spanEnd!
      if (a0 === b0 && a1 === b1) continue
      const olen = spanOverlapLen(a0, a1, b0, b1)
      const minLen = Math.min(a1 - a0, b1 - b0)
      if (minLen > 0 && olen / minLen >= SPAN_OVERLAP_DUPLICATE_RATIO) {
        addFlag(batchExtra, a.subtitleId, 'duplicate_span')
        addFlag(batchExtra, b.subtitleId, 'duplicate_span')
      }
    }
  }

  const byId = new Map(mergedPre.map((r) => [r.subtitleId, r]))
  for (let k = 1; k < expectedSubtitleIds.length; k++) {
    const prevId = expectedSubtitleIds[k - 1]!
    const curId = expectedSubtitleIds[k]!
    const earlier = byId.get(prevId)
    const later = byId.get(curId)
    if (!earlier || !later) continue
    if (!rowSpanEligible(earlier) || !rowSpanEligible(later)) continue
    if (later.spanStart! < earlier.spanStart! - ORDER_SPAN_BACKTRACK_TOLERANCE) {
      addFlag(batchExtra, later.subtitleId, 'order_span_violation')
    }
    const olen = spanOverlapLen(
      earlier.spanStart!,
      earlier.spanEnd!,
      later.spanStart!,
      later.spanEnd!
    )
    const minLen = Math.min(
      earlier.spanEnd! - earlier.spanStart!,
      later.spanEnd! - later.spanStart!
    )
    if (minLen > 0 && olen / minLen >= ADJACENT_SPAN_OVERLAP_RATIO) {
      addFlag(batchExtra, earlier.subtitleId, 'adjacent_span_heavy_overlap')
      addFlag(batchExtra, later.subtitleId, 'adjacent_span_heavy_overlap')
    }
  }

  const finalRows = mergedPre.map((r) => {
    const add = batchExtra.get(r.subtitleId)
    if (!add || add.size === 0) return r
    const mergedFlags = [...new Set([...r.validationFlags, ...add])]
    return {
      ...r,
      validationFlags: mergedFlags,
      applyable: computeMatchApplyable(mergedFlags)
    }
  })

  return finalRows
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
