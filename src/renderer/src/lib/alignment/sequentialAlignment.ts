import type { CandidateSegmentGroup } from '../../types'
import { BATCH_START_MAX_SEGMENT_OFFSET } from './applyPolicy'
import { MAX_SEGMENT_FORWARD_GAP } from './constants'
import type { AlignmentMatchValidated, AlignmentMatchValidationFlag } from './types'

export interface AlignmentDriftResult {
  drift: boolean
  reasons: string[]
}

const HARD_BLOCK_FLAGS: AlignmentMatchValidationFlag[] = [
  'invalid_candidate',
  'invalid_segment_id',
  'duplicate_segment',
  'invalid_group_id',
  'english_not_from_group',
  'missing_subtitle',
  'empty_english',
  'segment_jump',
  'segment_backward',
  'sequential_fallback',
  'alignment_drift'
]

/** 是否通过结构校验（整文件是否写入 english 另见 applyPolicy.isStructuralAIWritable / deriveStatusAfterAI）。 */
export function computeMatchApplyable(flags: AlignmentMatchValidationFlag[]): boolean {
  return !flags.some((f) => HARD_BLOCK_FLAGS.includes(f))
}

function groupsByIdMap(groups: CandidateSegmentGroup[]): Map<string, CandidateSegmentGroup> {
  return new Map(groups.map((g) => [g.id, g]))
}

function flagSet(flags: AlignmentMatchValidationFlag[]): Set<AlignmentMatchValidationFlag> {
  return new Set(flags)
}

/** 按字幕顺序检查 segment 是否大体向前、无大跳/回跳、无空英文。 */
export function applySequentialConstraints(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  candidateGroups: CandidateSegmentGroup[]
): AlignmentMatchValidated[] {
  const groupsById = groupsByIdMap(candidateGroups)
  const byId = new Map(rows.map((r) => [r.subtitleId, r]))
  let lastEnd = -1
  const out: AlignmentMatchValidated[] = []

  for (const subtitleId of expectedSubtitleIds) {
    const row = byId.get(subtitleId)
    if (!row) {
      out.push({
        subtitleId,
        groupId: '',
        matchedSegmentIds: [],
        english: '',
        confidence: 0,
        reason: '',
        validationFlags: ['missing_subtitle'],
        applyable: false
      })
      continue
    }

    const flags = flagSet(row.validationFlags)
    if (!row.english.trim()) flags.add('empty_english')

    const g = groupsById.get(row.groupId)
    if (g && row.matchedSegmentIds.length > 0) {
      const start = g.startSegmentIndex
      const end = g.endSegmentIndex
      if (lastEnd >= 0) {
        if (start < lastEnd) flags.add('segment_backward')
        const gap = start - lastEnd - 1
        if (gap > MAX_SEGMENT_FORWARD_GAP) flags.add('segment_jump')
      }
      const flagArrPreview = [...flags]
      if (computeMatchApplyable(flagArrPreview)) {
        lastEnd = Math.max(lastEnd, end)
      }
    }

    const flagArr = [...flags]
    out.push({
      ...row,
      validationFlags: flagArr,
      applyable: computeMatchApplyable(flagArr)
    })
  }

  return out
}

function pickNextSequentialGroup(
  candidateGroups: CandidateSegmentGroup[],
  minStartIndex: number,
  used: Set<string>
): CandidateSegmentGroup | null {
  const eligible = candidateGroups
    .filter((g) => {
      if (g.startSegmentIndex < minStartIndex) return false
      return g.segmentIds.every((id) => !used.has(id))
    })
    .sort((a, b) => {
      if (a.startSegmentIndex !== b.startSegmentIndex) {
        return a.startSegmentIndex - b.startSegmentIndex
      }
      return a.segmentIds.length - b.segmentIds.length
    })

  return eligible[0] ?? null
}

/** 批首字幕若匹配明显靠后的 transcript 段，标 alignment_drift 并禁止自动应用。 */
export function applyBatchStartSectionGuard(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  candidateGroups: CandidateSegmentGroup[],
  englishCursor: number
): AlignmentMatchValidated[] {
  if (expectedSubtitleIds.length === 0) return rows
  const firstId = expectedSubtitleIds[0]!
  const maxStart = englishCursor + BATCH_START_MAX_SEGMENT_OFFSET
  const groupsById = groupsByIdMap(candidateGroups)

  return rows.map((row) => {
    if (row.subtitleId !== firstId) return row
    const g = groupsById.get(row.groupId)
    if (!g || g.startSegmentIndex <= maxStart) return row
    const flags = [...new Set<AlignmentMatchValidationFlag>([...row.validationFlags, 'alignment_drift'])]
    return {
      ...row,
      validationFlags: flags,
      applyable: computeMatchApplyable(flags)
    }
  })
}

/**
 * 为缺失/不可应用行生成 sequential_fallback 建议（仅候选，不写入 english）。
 */
export function repairBatchCompleteness(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  candidateGroups: CandidateSegmentGroup[],
  options?: { usedSegmentIdsGlobal?: Set<string> }
): { rows: AlignmentMatchValidated[]; repairedSubtitleIds: number[] } {
  const used = new Set(options?.usedSegmentIdsGlobal ?? [])
  for (const r of rows) {
    if (r.applyable) for (const id of r.matchedSegmentIds) used.add(id)
  }

  const byId = new Map(rows.map((r) => [r.subtitleId, r]))
  let cursorSeg = -1
  for (const r of rows) {
    if (!r.applyable) continue
    const g = candidateGroups.find((x) => x.id === r.groupId)
    if (g) cursorSeg = Math.max(cursorSeg, g.endSegmentIndex)
  }

  const repairedSubtitleIds: number[] = []
  const out: AlignmentMatchValidated[] = []

  for (const subtitleId of expectedSubtitleIds) {
    const existing = byId.get(subtitleId)
    if (existing?.applyable && existing.english.trim()) {
      const g = candidateGroups.find((x) => x.id === existing.groupId)
      if (g) cursorSeg = Math.max(cursorSeg, g.endSegmentIndex)
      out.push(existing)
      continue
    }

    const minStart = cursorSeg < 0 ? 0 : cursorSeg + 1
    const group = pickNextSequentialGroup(candidateGroups, minStart, used)
    if (group) {
      repairedSubtitleIds.push(subtitleId)
      out.push({
        subtitleId,
        groupId: group.id,
        matchedSegmentIds: [...group.segmentIds],
        english: group.text,
        confidence: 0.35,
        reason: 'sequential fallback suggestion (not auto-applied)',
        validationFlags: ['sequential_fallback'],
        applyable: false
      })
      continue
    }

    if (existing) {
      out.push(existing)
    } else {
      out.push({
        subtitleId,
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

  return { rows: out, repairedSubtitleIds }
}

export function detectAlignmentDrift(
  rows: AlignmentMatchValidated[],
  expectedSubtitleIds: number[]
): AlignmentDriftResult {
  const reasons: string[] = []
  const ordered = expectedSubtitleIds
    .map((id) => rows.find((r) => r.subtitleId === id))
    .filter((r): r is AlignmentMatchValidated => r != null)

  const badRows = ordered.filter((r) => !r.applyable || !r.english.trim())
  const jumpRows = ordered.filter((r) => r.validationFlags.includes('segment_jump'))
  const backRows = ordered.filter((r) => r.validationFlags.includes('segment_backward'))
  const dupRows = ordered.filter((r) => r.validationFlags.includes('duplicate_segment'))
  const emptyRows = ordered.filter((r) => r.validationFlags.includes('empty_english'))

  if (badRows.length >= 2) {
    reasons.push(`${badRows.length} subtitles unmatched or not applyable`)
  }
  if (jumpRows.length > 0) {
    reasons.push(`segment jump on subtitle(s): ${jumpRows.map((r) => r.subtitleId).join(', ')}`)
  }
  if (backRows.length > 0) {
    reasons.push(`segment backward on subtitle(s): ${backRows.map((r) => r.subtitleId).join(', ')}`)
  }
  if (dupRows.length > 0) {
    reasons.push('duplicate segment reuse within batch')
  }
  if (emptyRows.length > 0) {
    reasons.push(`empty english on subtitle(s): ${emptyRows.map((r) => r.subtitleId).join(', ')}`)
  }

  return { drift: reasons.length > 0, reasons }
}

export function stampAlignmentDrift(
  rows: AlignmentMatchValidated[],
  drift: AlignmentDriftResult
): AlignmentMatchValidated[] {
  if (!drift.drift) return rows
  return rows.map((r) => {
    const flags = [...new Set<AlignmentMatchValidationFlag>([...r.validationFlags, 'alignment_drift'])]
    return {
      ...r,
      validationFlags: flags,
      applyable: computeMatchApplyable(flags)
    }
  })
}

export function finalizeBatchAlignment(
  rawValidated: AlignmentMatchValidated[],
  expectedSubtitleIds: number[],
  candidateGroups: CandidateSegmentGroup[],
  options?: { usedSegmentIdsGlobal?: Set<string>; englishCursor?: number }
): {
  validated: AlignmentMatchValidated[]
  drift: AlignmentDriftResult
  repairedSubtitleIds: number[]
} {
  let rows = applySequentialConstraints(rawValidated, expectedSubtitleIds, candidateGroups)
  if (options?.englishCursor != null) {
    rows = applyBatchStartSectionGuard(
      rows,
      expectedSubtitleIds,
      candidateGroups,
      options.englishCursor
    )
  }
  const { rows: repaired, repairedSubtitleIds } = repairBatchCompleteness(
    rows,
    expectedSubtitleIds,
    candidateGroups,
    options
  )
  rows = applySequentialConstraints(repaired, expectedSubtitleIds, candidateGroups)
  const drift = detectAlignmentDrift(rows, expectedSubtitleIds)
  rows = stampAlignmentDrift(rows, drift)
  return { validated: rows, drift, repairedSubtitleIds }
}
