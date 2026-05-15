import type { LocalEnglishContextBlock } from './englishBlock'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { computeMatchApplyable } from './matchFlags'
import type { AlignmentMatchValidated } from './types'

export interface AlignmentDriftResult {
  drift: boolean
  reasons: string[]
}

export function detectAlignmentDrift(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  localEnglishContext: LocalEnglishContextBlock | null,
  _englishCursor: number,
  poolLength: number,
  _windowSize: number = DEFAULT_GROUP_WINDOW
): AlignmentDriftResult {
  const reasons: string[] = []
  const n = expectedSubtitleIds.length
  if (n === 0) return { drift: false, reasons: [] }
  if (!localEnglishContext || poolLength <= 0) return { drift: false, reasons: [] }

  let missingOrEmpty = 0
  let notInContext = 0
  let badSegment = 0

  for (const id of expectedSubtitleIds) {
    const r = rows.find((x) => x.subtitleId === id)
    if (!r || r.validationFlags.includes('missing_subtitle') || !r.english.trim()) {
      missingOrEmpty++
      continue
    }
    if (r.validationFlags.includes('english_not_in_context')) {
      notInContext++
      continue
    }
    if (
      r.validationFlags.includes('invalid_segment_id') ||
      r.validationFlags.includes('non_contiguous_segments')
    ) {
      badSegment++
      continue
    }
  }

  const threshold = Math.max(3, Math.ceil(n * 0.5))
  if (missingOrEmpty >= threshold) {
    reasons.push(`majority subtitles missing model english (${missingOrEmpty}/${n})`)
  }
  if (notInContext >= threshold) {
    reasons.push(`majority english not contiguous substring of local context (${notInContext}/${n})`)
  }
  if (badSegment >= threshold) {
    reasons.push(`majority invalid segment span (${badSegment}/${n})`)
  }

  return { drift: reasons.length > 0, reasons }
}

export function finalizeBatchAlignment(
  rawValidated: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  localEnglishContext: LocalEnglishContextBlock | null,
  options?: {
    englishCursor?: number
    poolLength?: number
    windowSize?: number
  }
): {
  validated: AlignmentMatchValidated[]
  drift: AlignmentDriftResult
} {
  const rows = rawValidated.map((r) => ({
    ...r,
    applyable: computeMatchApplyable(r.validationFlags)
  }))
  const drift = detectAlignmentDrift(
    rows,
    expectedSubtitleIds,
    localEnglishContext,
    options?.englishCursor ?? 0,
    options?.poolLength ?? 0,
    options?.windowSize ?? DEFAULT_GROUP_WINDOW
  )
  return { validated: rows, drift }
}
