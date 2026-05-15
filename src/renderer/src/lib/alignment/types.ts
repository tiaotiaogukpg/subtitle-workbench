import type { CandidateSegmentGroup, SubtitleStatus } from '../../types'
import type { LocalEnglishContextBlock } from './englishBlock'

export interface AlignmentPromptSubtitle {
  subtitleId: number
  orderIndex: number
  chinese: string
}

export interface AlignmentMatchRow {
  subtitleId: number
  groupId: string
  matchedSegmentIds: string[]
  english: string
  confidence: number
  reason: string
  /** 模型可选；与 `localEnglishContextBlock` 对齐的元信息。 */
  sourceContextIds?: string[]
  /** `english` 在 space-normalized 的 `localEnglishContextBlock.text` 中的 [start, end) 字符区间。 */
  spanStart?: number
  spanEnd?: number
  /** 模型原始给出的 local 区间（若有）。 */
  declaredSpanStart?: number
  declaredSpanEnd?: number
  /** local span 映射到整池规范化串联串后的 [start,end)。 */
  globalSpanStart?: number
  globalSpanEnd?: number
}

/** 对齐结果校验标记（`ALIGNMENT_HARD_BLOCK_FLAGS` 子集为硬阻断；其余为警告）。 */
export type AlignmentMatchValidationFlag =
  | 'invalid_candidate'
  | 'invalid_segment_id'
  | 'english_not_in_context'
  | 'non_contiguous_segments'
  | 'duplicate_english_in_batch'
  | 'duplicate_span'
  | 'span_mismatch'
  | 'order_span_violation'
  | 'identical_span_reuse'
  | 'adjacent_span_heavy_overlap'
  | 'missing_subtitle'
  | 'empty_english'

export interface AlignmentMatchValidated extends AlignmentMatchRow {
  validationFlags: AlignmentMatchValidationFlag[]
  applyable: boolean
}

export interface AlignmentModelResponseShape {
  matches: AlignmentMatchRow[]
}

export interface BatchAlignmentPromptInput {
  subtitles: AlignmentPromptSubtitle[]
  candidateGroups: CandidateSegmentGroup[]
  localEnglishContext?: LocalEnglishContextBlock | null
}

export function confidenceToPercent(conf: number): number {
  if (!Number.isFinite(conf)) return 0
  if (conf > 0 && conf <= 1) return Math.round(conf * 100)
  return Math.round(Math.min(100, Math.max(0, conf)))
}

export function statusFromConfidencePct(pct: number): SubtitleStatus {
  if (pct > 90) return 'confirmed'
  if (pct >= 60) return 'low_confidence'
  return 'unmatched'
}
