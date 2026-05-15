import { computeMatchApplyable } from './matchFlags'
import { normalizeGroupText } from './textUtils'
import { confidenceToPercent, type AlignmentMatchValidated } from './types'

const SUBORD_OVERLAP_PREFIX = /^\s*(because|when|if|that|while|as)\b/i

function rowHasUsableSpan(m: AlignmentMatchValidated): boolean {
  if (m.validationFlags.includes('missing_subtitle')) return false
  if (!m.english.trim()) return false
  if (m.spanStart == null || m.spanEnd == null) return false
  if (!Number.isInteger(m.spanStart) || !Number.isInteger(m.spanEnd)) return false
  return m.spanStart < m.spanEnd
}

function spanOverlapLen(a0: number, a1: number, b0: number, b1: number): number {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return Math.max(0, hi - lo)
}

/**
 * 相邻对：尾部重叠且较短英文为较长英文的后缀、且重叠以从属连词开头时，裁剪前句 span（避免双 needs_review）。
 */
function applyAdjacentTailOverlapTrims(
  validated: AlignmentMatchValidated[],
  byId: Map<number, AlignmentMatchValidated>,
  expectedSubtitleIds: number[],
  ctxNorm: string
): void {
  for (let k = 0; k < expectedSubtitleIds.length - 1; k++) {
    const idA = expectedSubtitleIds[k]!
    const idB = expectedSubtitleIds[k + 1]!
    const A = byId.get(idA)
    const B = byId.get(idB)
    if (!A || !B) continue
    if (!rowHasUsableSpan(A) || !rowHasUsableSpan(B)) continue

    const a0 = A.spanStart!
    const a1 = A.spanEnd!
    const b0 = B.spanStart!
    const b1 = B.spanEnd!
    if (b0 <= a0 || b0 >= a1) continue

    const earlierNorm = ctxNorm.slice(a0, a1)
    const laterNorm = ctxNorm.slice(b0, b1)
    if (laterNorm.length >= earlierNorm.length) continue
    if (!earlierNorm.endsWith(laterNorm)) continue

    const olen = spanOverlapLen(a0, a1, b0, b1)
    if (olen <= 0) continue
    const overlapText = ctxNorm.slice(b0, Math.min(a1, b1))
    if (!SUBORD_OVERLAP_PREFIX.test(overlapText)) continue

    const newEnd = b0
    const newEnglish = ctxNorm.slice(a0, newEnd).trimEnd()
    if (newEnglish.length < 2) continue

    A.english = newEnglish
    A.spanEnd = newEnd
    A.declaredSpanEnd = newEnd
    A.spanStart = a0
    A.declaredSpanStart = a0
    A.validationFlags = A.validationFlags.filter(
      (f) => f !== 'span_overlap_needs_trim' && f !== 'duplicate_span' && f !== 'span_mismatch'
    )
    const nSlice = normalizeGroupText(ctxNorm.slice(a0, newEnd))
    const nEn = normalizeGroupText(newEnglish)
    if (!A.validationFlags.includes('span_mismatch')) {
      A.validationFlags = [...A.validationFlags, 'span_mismatch']
    }
  }
}

/** identical span 组：选一 winner，其余 loser 清空英文并标 semantic_undersegmentation（避免双空）。 */
function resolveIdenticalSpanWinners(
  validated: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  chineseBySubtitleId: Map<number, string>
): void {
  const keyToRows = new Map<string, AlignmentMatchValidated[]>()
  for (const r of validated) {
    if (!rowHasUsableSpan(r)) continue
    const key = `${r.spanStart}:${r.spanEnd}`
    const arr = keyToRows.get(key) ?? []
    arr.push(r)
    keyToRows.set(key, arr)
  }

  for (const group of keyToRows.values()) {
    const uniq = [...new Map(group.map((r) => [r.subtitleId, r])).values()]
    if (uniq.length < 2) continue
    if (!uniq.some((r) => r.validationFlags.includes('identical_span_reuse'))) continue

    const scored = uniq.map((r) => {
      const idx = expectedSubtitleIds.indexOf(r.subtitleId)
      const cn = chineseBySubtitleId.get(r.subtitleId) ?? ''
      return { r, cn, orderIndex: Math.max(0, idx) }
    })
    scored.sort((a, b) => {
      const ca = confidenceToPercent(a.r.confidence)
      const cb = confidenceToPercent(b.r.confidence)
      if (cb !== ca) return cb - ca
      const la = a.r.spanEnd! - a.r.spanStart!
      const lb = b.r.spanEnd! - b.r.spanStart!
      if (la !== lb) return la - lb
      const dA = Math.abs(a.r.english.trim().length - a.cn.length)
      const dB = Math.abs(b.r.english.trim().length - b.cn.length)
      if (dA !== dB) return dA - dB
      const ha = /[？?]|「|“|"]/.test(a.cn) ? 1 : 0
      const hb = /[？?]|「|“|"]/.test(b.cn) ? 1 : 0
      if (hb !== ha) return hb - ha
      return b.orderIndex - a.orderIndex
    })
    const winner = scored[0]!.r

    winner.validationFlags = winner.validationFlags.filter((f) => f !== 'identical_span_reuse')

    for (let i = 1; i < scored.length; i++) {
      const loser = scored[i]!.r
      loser.english = ''
      loser.confidence = 0
      loser.reason = ''
      loser.matchedSegmentIds = []
      loser.spanStart = undefined
      loser.spanEnd = undefined
      loser.declaredSpanStart = undefined
      loser.declaredSpanEnd = undefined
      loser.globalSpanStart = undefined
      loser.globalSpanEnd = undefined
      loser.validationFlags = ['semantic_undersegmentation']
    }
  }
}

export function applyPostBatchSegmentationPolicy(input: {
  validated: AlignmentMatchValidated[]
  expectedSubtitleIds: number[]
  chineseBySubtitleId: Map<number, string>
  contextNorm: string
}): void {
  const { validated, expectedSubtitleIds, chineseBySubtitleId, contextNorm } = input
  const byId = new Map(validated.map((r) => [r.subtitleId, r]))

  applyAdjacentTailOverlapTrims(validated, byId, expectedSubtitleIds, contextNorm)
  resolveIdenticalSpanWinners(validated, expectedSubtitleIds, chineseBySubtitleId)

  for (const r of validated) {
    r.applyable = computeMatchApplyable(r.validationFlags)
  }
}
