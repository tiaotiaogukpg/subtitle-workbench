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
}

/** 对齐结果最小校验标记（仅硬阻断写入）。 */
export type AlignmentMatchValidationFlag =
  | 'invalid_candidate'
  | 'invalid_segment_id'
  | 'english_not_in_context'
  | 'non_contiguous_segments'
  | 'duplicate_english_in_batch'
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
