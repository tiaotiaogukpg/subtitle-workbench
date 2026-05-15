import type { SubtitleStatus } from '../../types'

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

export type AlignmentMatchValidationFlag =
  | 'invalid_candidate'
  | 'invalid_segment_id'
  | 'duplicate_segment'
  | 'invalid_group_id'
  | 'english_not_from_group'
  | 'missing_subtitle'
  | 'empty_english'
  | 'segment_jump'
  | 'segment_backward'
  | 'sequential_fallback'
  | 'alignment_drift'

export interface AlignmentMatchValidated extends AlignmentMatchRow {
  validationFlags: AlignmentMatchValidationFlag[]
  applyable: boolean
}

export interface AlignmentModelResponseShape {
  matches: AlignmentMatchRow[]
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
