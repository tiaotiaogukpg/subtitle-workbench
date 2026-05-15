import type { ScriptSegment, SubtitleLine } from '../../types'
import { pickSmallBatchSubtitles } from './batchSelection'
import { buildCandidateGroups } from './candidateGroups'
import { buildAlignmentReport } from './completeness'
import { DEFAULT_GROUP_WINDOW } from './constants'
import { buildLocalEnglishContextBlock } from './englishBlock'
import { filterEnglishPoolSegments, resolveSandboxEnglishCursor } from './englishPool'
import {
  buildBatchAlignmentPrompt,
  estimatePromptTokens,
  parseAlignmentModelJson
} from './promptBuilder'
import type { AlignmentMatchRow, AlignmentMatchValidated } from './types'
import {
  buildAlignmentBatchPipelineDiagnostics,
  logAlignmentBatchPipelineDiagnostics,
  type AlignmentBatchPipelineDiagnostics
} from './alignmentDiagnostics'
import { pickBestStructuralAIForSubtitle } from './applyPolicy'
import { finalizeBatchAlignment } from './sequentialAlignment'
import {
  buildValidationWarnings,
  validateAlignmentResult
} from './validation'
import type { CandidateSegmentGroup } from '../../types'

export interface SmallBatchAlignmentDebug {
  promptTokenEstimate: number
  rawResponse: string
  parseError: string | null
  parsedJson: string | null
  latencyMs: number
  usagePromptTokens: number | null
  candidateGroupCount: number
  englishPoolSize: number
  englishCursor: number
  validationWarnings: string[]
  localContextLabel: string
  /** 单批完整 pipeline 快照（与控制台 `[alignment-pipeline]` 一致）。 */
  pipelineTrace?: AlignmentBatchPipelineDiagnostics | null
}

export interface SmallBatchAlignmentSuccess {
  ok: true
  batch: SubtitleLine[]
  batchSubtitleIds: number[]
  candidateGroups: CandidateSegmentGroup[]
  validated: AlignmentMatchValidated[]
  applyable: AlignmentMatchRow[]
  report: ReturnType<typeof buildAlignmentReport>
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
  /** 整文件模式下前序批次已占用的 segment，避免跨批重复。 */
  usedSegmentIdsGlobal?: Set<string>
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

  const candidateGroups = buildCandidateGroups({
    englishSegments: engPool,
    cursor,
    windowSize: DEFAULT_GROUP_WINDOW
  })

  if (candidateGroups.length === 0) {
    return {
      ok: false,
      error: '当前游标窗口内无法组成英文候选组。',
      debug: {
        promptTokenEstimate: 0,
        rawResponse: '',
        parseError: null,
        parsedJson: null,
        latencyMs: 0,
        usagePromptTokens: null,
        candidateGroupCount: 0,
        englishPoolSize: engPool.length,
        englishCursor: cursor,
        validationWarnings: [],
        localContextLabel: '—'
      }
    }
  }

  const localEnglishContext = buildLocalEnglishContextBlock({
    englishSegments: engPool,
    cursor
  })
  const localContextLabel = localEnglishContext
    ? `pool[${localEnglishContext.startSegmentIndex}…${localEnglishContext.endSegmentIndex}] · ${localEnglishContext.segmentCount} segs`
    : '—'

  const promptSubs = batch.map((l, i) => ({
    subtitleId: l.id,
    orderIndex: i + 1,
    chinese: l.chinese
  }))
  const { messages, promptCharCount } = buildBatchAlignmentPrompt({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext
  })
  const est = estimatePromptTokens(messages.map((m) => m.content).join('\n'))

  const api = await bridge.alignDeepSeekBatch({ model: input.model, messages })
  if (!api.ok) {
    return {
      ok: false,
      error: api.error,
      debug: {
        promptTokenEstimate: est,
        rawResponse: '',
        parseError: null,
        parsedJson: null,
        latencyMs: 0,
        usagePromptTokens: null,
        candidateGroupCount: candidateGroups.length,
        englishPoolSize: engPool.length,
        englishCursor: cursor,
        validationWarnings: [],
        localContextLabel
      }
    }
  }

  const usagePt = api.usage?.prompt_tokens ?? null
  const parsed = parseAlignmentModelJson(api.rawText)
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      debug: {
        promptTokenEstimate: est,
        rawResponse: api.rawText,
        parseError: parsed.error,
        parsedJson: null,
        latencyMs: api.latencyMs,
        usagePromptTokens: usagePt,
        candidateGroupCount: candidateGroups.length,
        englishPoolSize: engPool.length,
        englishCursor: cursor,
        validationWarnings: [],
        localContextLabel
      }
    }
  }

  const batchSubtitleIds = batch.map((b) => b.id)
  const rawValidated = validateAlignmentResult({
    result: parsed.data.matches,
    candidateGroups,
    expectedSubtitleIds: batchSubtitleIds,
    usedSegmentIdsGlobal: input.usedSegmentIdsGlobal
  })
  const thresholdPct = input.confidenceThresholdPct ?? 60
  const { validated, drift, repairedSubtitleIds } = finalizeBatchAlignment(
    rawValidated,
    batchSubtitleIds,
    candidateGroups,
    { usedSegmentIdsGlobal: input.usedSegmentIdsGlobal, englishCursor: cursor }
  )
  const validationWarnings = [
    ...buildValidationWarnings(validated),
    ...(drift.drift ? [`alignment_drift: ${drift.reasons.join('; ')}`] : []),
    ...(repairedSubtitleIds.length > 0
      ? [`sequential_fallback suggestions (not auto-applied): ${repairedSubtitleIds.join(', ')}`]
      : [])
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

  const pipelineTrace = buildAlignmentBatchPipelineDiagnostics({
    batch,
    engPool,
    cursor,
    windowSize: DEFAULT_GROUP_WINDOW,
    localEnglishContext,
    candidateGroups,
    messages,
    rawResponse: api.rawText,
    validated,
    batchSubtitleIds,
    thresholdPct
  })
  logAlignmentBatchPipelineDiagnostics(pipelineTrace)

  return {
    ok: true,
    batch,
    batchSubtitleIds,
    candidateGroups,
    validated,
    applyable,
    report,
    debug: {
      promptTokenEstimate: est,
      rawResponse: api.rawText,
      parseError: null,
      parsedJson: JSON.stringify({ matches: validated, report }, null, 2),
      latencyMs: api.latencyMs,
      usagePromptTokens: usagePt,
      candidateGroupCount: candidateGroups.length,
      englishPoolSize: engPool.length,
      englishCursor: cursor,
      validationWarnings,
      localContextLabel,
      pipelineTrace
    }
  }
}
