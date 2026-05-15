import { computeMatchApplyable } from './matchFlags'
import type { AlignmentMatchValidated } from './types'

export function finalizeBatchAlignment(
  rawValidated: AlignmentMatchValidated[]
): {
  validated: AlignmentMatchValidated[]
} {
  const rows = rawValidated.map((r) => ({
    ...r,
    applyable: computeMatchApplyable(r.validationFlags)
  }))
  return { validated: rows }
}
