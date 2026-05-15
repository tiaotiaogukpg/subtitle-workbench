import type { CandidateSegmentGroup, ScriptSegment, SubtitleLine } from '../../types'
import { pickSmallBatchSubtitles } from './batchSelection'
import { buildCandidateGroups } from './candidateGroups'
import { buildAlignmentReport } from './completeness'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { buildLocalEnglishContextBlock } from './englishBlock'
import { filterEnglishPoolSegments, resolveSandboxEnglishCursor } from './englishPool'
import {
  buildBatchAlignmentPrompt,
  buildBatchAlignmentUserPayload,
  parseAlignmentModelJson
} from './promptBuilder'
import type { AlignmentMatchRow, AlignmentMatchValidated } from './types'
import { pickBestStructuralAIForSubtitle } from './applyPolicy'
import { finalizeBatchAlignment } from './sequentialAlignment'
import { buildValidationWarnings, validateAlignmentResult } from './validation'

function excerptText(text: string | null | undefined, maxLen: number): string | null {
  const t = text?.trim()
  if (!t) return null
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t
}

/** 小批调试：仅含必要诊断字段（不影响主流程）。 */
export interface SmallBatchAlignmentDebug {
  promptPreview: string
  rawResponse: string
  validationResult: string[]
  localEnglishExcerpt: string | null
}

export interface SmallBatchAlignmentSuccess {
  ok: true
  batch: SubtitleLine[]
  batchSubtitleIds: number[]
  candidateGroups: CandidateSegmentGroup[]
  validated: AlignmentMatchValidated[]
  applyable: AlignmentMatchRow[]
  report: ReturnType<typeof buildAlignmentReport>
  englishCursor: number
  englishPoolSize: number
  debug: SmallBatchAlignmentDebug
}

export type SmallBatchAlignmentResult =
  | SmallBatchAlignmentSuccess
  | { ok: false; error: string; debug: SmallBatchAlignmentDebug | null }

export interface RunSmallBatchAlignmentInput {
  subtitles: SubtitleLine[]
  currentSubtitleId: number | null
  segments: ScriptSegment[]
  englishCursor: number
  model: string
  batchSize?: number
  confidenceThresholdPct?: number
}

export async function runSmallBatchAlignment(
  input: RunSmallBatchAlignmentInput
): Promise<SmallBatchAlignmentResult> {
  const bridge = window.bilingualSubtitleAligner
  if (!bridge?.alignDeepSeekBatch) {
    return { ok: false, error: '真实对齐仅在 Electron 桌面端可用（安全桥接未加载）。', debug: null }
  }

  const batch = pickSmallBatchSubtitles(
    input.subtitles,
    input.currentSubtitleId,
    input.batchSize
  )
  if (batch.length === 0) {
    return { ok: false, error: '没有可对齐的中文字幕。请先导入 SRT。', debug: null }
  }

  const engPool = filterEnglishPoolSegments(input.segments)
  if (engPool.length === 0) {
    return {
      ok: false,
      error: '没有符合「英文标签 + 纯英文文本」的 Script Pool 片段。请检查英文稿。',
      debug: null
    }
  }

  const startIdx = Math.max(0, input.subtitles.findIndex((l) => l.id === batch[0]!.id))
  const cursor =
    input.englishCursor > 0
      ? Math.min(input.englishCursor, engPool.length - 1)
      : resolveSandboxEnglishCursor(engPool.length, startIdx, input.subtitles.length, DEFAULT_GROUP_WINDOW)

  const localEnglishContext = buildLocalEnglishContextBlock({
    englishSegments: engPool,
    cursor
  })
  const localEnglishExcerpt = excerptText(localEnglishContext?.text, 600)

  const promptSubs = batch.map((l, i) => ({
    subtitleId: l.id,
    orderIndex: i + 1,
    chinese: l.chinese
  }))

  const candidateGroups = buildCandidateGroups({
    englishSegments: engPool,
    cursor,
    windowSize: DEFAULT_GROUP_WINDOW
  })

  const promptPreview = buildBatchAlignmentUserPayload({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext
  })

  if (candidateGroups.length === 0) {
    return {
      ok: false,
      error: '当前游标窗口内无法组成英文候选组。',
      debug: {
        promptPreview,
        rawResponse: '',
        validationResult: ['No candidate groups in window.'],
        localEnglishExcerpt
      }
    }
  }

  const { messages } = buildBatchAlignmentPrompt({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext
  })

  const api = await bridge.alignDeepSeekBatch({ model: input.model, messages })
  if (!api.ok) {
    return {
      ok: false,
      error: api.error,
      debug: {
        promptPreview,
        rawResponse: '',
        validationResult: [],
        localEnglishExcerpt
      }
    }
  }

  const parsed = parseAlignmentModelJson(api.rawText)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      debug: {
        promptPreview,
        rawResponse: api.rawText,
        validationResult: [`parse: ${parsed.error}`],
        localEnglishExcerpt
      }
    }
  }

  const batchSubtitleIds = batch.map((b) => b.id)
  const rawValidated = validateAlignmentResult({
    result: parsed.data.matches,
    candidateGroups,
    expectedSubtitleIds: batchSubtitleIds,
    alignmentWindow: {
      englishCursor: cursor,
      poolLength: engPool.length,
      windowSize: DEFAULT_GROUP_WINDOW
    }
  })
  const { validated, drift } = finalizeBatchAlignment(
    rawValidated,
    batchSubtitleIds,
    candidateGroups,
    {
      englishCursor: cursor,
      poolLength: engPool.length,
      windowSize: DEFAULT_GROUP_WINDOW
    }
  )
  const validationResult = [
    ...buildValidationWarnings(validated),
    ...(drift.drift ? [`alignment_drift: ${drift.reasons.join('; ')}`] : [])
  ]
  const applyable: AlignmentMatchRow[] = []
  for (const id of batchSubtitleIds) {
    const best = pickBestStructuralAIForSubtitle(
      validated,
      id,
      candidateGroups,
      cursor,
      engPool.length,
      DEFAULT_GROUP_WINDOW
    )
    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      applyable.push(row)
    }
  }

  const report = buildAlignmentReport(batchSubtitleIds, validated, candidateGroups, {
    confidenceThresholdPct: input.confidenceThresholdPct,
    drift
  })

  return {
    ok: true,
    batch,
    batchSubtitleIds,
    candidateGroups,
    validated,
    applyable,
    report,
    englishCursor: cursor,
    englishPoolSize: engPool.length,
    debug: {
      promptPreview,
      rawResponse: api.rawText,
      validationResult,
      localEnglishExcerpt
    }
  }
}
