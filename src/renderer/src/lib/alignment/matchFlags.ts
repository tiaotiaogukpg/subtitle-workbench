import type { AlignmentMatchValidationFlag } from './types'

/** 是否通过结构校验（整文件是否写入 english 另见 applyPolicy）。 */
export const ALIGNMENT_HARD_BLOCK_FLAGS: AlignmentMatchValidationFlag[] = [
  'invalid_candidate',
  'english_not_in_context',
  'identical_span_reuse',
  'duplicate_span',
  'duplicate_english_in_batch',
  'adjacent_span_heavy_overlap',
  'missing_subtitle',
  'empty_english'
]

export function computeMatchApplyable(flags: AlignmentMatchValidationFlag[]): boolean {
  return !flags.some((f) => ALIGNMENT_HARD_BLOCK_FLAGS.includes(f))
}
