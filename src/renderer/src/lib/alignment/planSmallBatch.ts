import type { CandidateSegmentGroup, ScriptSegment, SubtitleLine } from '../../types'
import { pickSmallBatchSubtitles } from './batchSelection'
import { buildCandidateGroups } from './candidateGroups'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { buildLocalEnglishContextBlock, formatLocalEnglishContextLabel } from './englishBlock'
import { filterEnglishPoolSegments, resolveSandboxEnglishCursor } from './englishPool'
import { buildBatchAlignmentPrompt, buildBatchAlignmentUserPayload } from './promptBuilder'

export interface SmallBatchAlignmentPlan {
  batch: SubtitleLine[]
  engPool: ScriptSegment[]
  cursor: number
  windowEnd: number
  candidateGroups: CandidateSegmentGroup[]
  subtitleRangeLabel: string
  englishWindowLabel: string
  localContextLabel: string
  promptUserPayloadPreview: string
  promptCharCount: number
}

/** 不调用 API：根据当前游标与 batchSize 计算候选组与 prompt 负载预览。 */
export function computeSmallBatchAlignmentPlan(input: {
  subtitles: SubtitleLine[]
  currentSubtitleId: number | null
  segments: ScriptSegment[]
  englishCursor: number
  batchSize: number
}): SmallBatchAlignmentPlan | null {
  const { subtitles, currentSubtitleId, segments, englishCursor, batchSize } = input
  const batch = pickSmallBatchSubtitles(subtitles, currentSubtitleId, batchSize)
  if (batch.length === 0) return null
  const engPool = filterEnglishPoolSegments(segments)
  if (engPool.length === 0) return null

  const startIdx = Math.max(0, subtitles.findIndex((l) => l.id === batch[0]!.id))
  const cursor =
    englishCursor > 0
      ? Math.min(englishCursor, engPool.length - 1)
      : resolveSandboxEnglishCursor(engPool.length, startIdx, subtitles.length, DEFAULT_GROUP_WINDOW)
  const windowEnd = Math.min(engPool.length - 1, cursor + DEFAULT_GROUP_WINDOW - 1)
  const candidateGroups = buildCandidateGroups({
    englishSegments: engPool,
    cursor,
    windowSize: DEFAULT_GROUP_WINDOW
  })

  const localEnglishContext = buildLocalEnglishContextBlock({
    englishSegments: engPool,
    cursor
  })
  const localContextLabel = localEnglishContext
    ? formatLocalEnglishContextLabel(localEnglishContext)
    : '—'

  const promptSubs = batch.map((l, i) => ({
    subtitleId: l.id,
    orderIndex: i + 1,
    chinese: l.chinese
  }))
  const promptUserPayloadPreview = buildBatchAlignmentUserPayload({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext
  })
  const { promptCharCount } = buildBatchAlignmentPrompt({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext
  })

  const subtitleRangeLabel = `#${batch[0]!.id}–#${batch[batch.length - 1]!.id}`
  const englishWindowLabel = `pool[${cursor}…${windowEnd}] · ${candidateGroups.length} groups`

  return {
    batch,
    engPool,
    cursor,
    windowEnd,
    candidateGroups,
    subtitleRangeLabel,
    englishWindowLabel,
    localContextLabel,
    promptUserPayloadPreview,
    promptCharCount
  }
}
