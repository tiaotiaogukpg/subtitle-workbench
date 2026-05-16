import type { CandidateSegmentGroup, ScriptSegment, SubtitleLine } from '../../types'
import { pickSmallBatchSubtitles } from './batchSelection'
import { buildDebugCandidateGroups } from './candidateGroups'
import { enrichAlignmentMatchesFromFullContext } from './contextEnrichment'
import { buildAlignmentReport } from './completeness'
import {
  BATCH_CONTEXT_ESCALATE_FAILURE_MIN,
  BATCH_CONTEXT_ESCALATE_FAILURE_RATIO
} from './constants'
import type { LocalEnglishContextBlock, TimeRatioContextMeta } from './englishBlock'
import { filterEnglishPoolSegments } from './englishPool'
import {
  buildBatchAlignmentPrompt,
  buildBatchAlignmentUserPayload,
  parseAlignmentModelJson
} from './promptBuilder'
import type {
  AlignmentMatchParseWarning,
  AlignmentPromptPass,
  AlignmentMatchRow,
  AlignmentMatchValidated
} from './types'
import { pickBestStructuralAIForSubtitle } from './applyPolicy'
import { finalizeBatchAlignment } from './sequentialAlignment'
import { buildTimeRatioEnglishContextBlock, type ContextWindowTier } from './timeRatioContext'
import {
  buildSpanOrderDiagnostics,
  buildSpanPairDiagnostics,
  buildValidationWarnings,
  validateAlignmentResult
} from './validation'
import { applyPostBatchSegmentationPolicy } from './postBatchSegmentationPolicy'
import { normalizeGroupText } from './textUtils'
import { useUiSettingsStore } from '../../store/uiSettingsStore'
import {
  logRetryApiOrParseFailure,
  logRetryContextBeforeDeepSeek,
  logRetryTierModelOutcome
} from './retryCoverageDiagnostics'

function isAlignmentPipelineDebug(): boolean {
  return useUiSettingsStore.getState().debugMode
}

function excerptText(text: string | null | undefined, maxLen: number): string | null {
  const t = text?.trim()
  if (!t) return null
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t
}

function buildSpanResolutionDebugLines(rows: AlignmentMatchValidated[]): string[] {
  return rows
    .filter((r) => !r.validationFlags.includes('missing_subtitle'))
    .map((r) => {
      const d =
        r.declaredSpanStart != null && r.declaredSpanEnd != null
          ? `[${r.declaredSpanStart},${r.declaredSpanEnd})`
          : '—'
      const loc =
        r.spanStart != null && r.spanEnd != null ? `[${r.spanStart},${r.spanEnd})` : '—'
      const g =
        r.globalSpanStart != null && r.globalSpanEnd != null
          ? `[${r.globalSpanStart},${r.globalSpanEnd})`
          : '—'
      return `#${r.subtitleId}: declared(local)=${d} resolved(local)=${loc} global=${g}`
    })
}

export interface TimeRatioContextDebug {
  batchStartMs: number
  batchEndMs: number
  batchMidMs: number
  totalDurationMs: number
  batchMidRatio: number
  englishCenterIndex: number
  windowStartSeg: number
  windowEndSeg: number
  windowTier: ContextWindowTier
  contextBeforeSegs: number
  contextAfterSegs: number
  contextCharCount: number
  /** 本批是否因失败过多而扩大窗口重试。 */
  windowEscalation?: string
}

function timeRatioDebugFromMeta(meta: TimeRatioContextMeta | undefined): TimeRatioContextDebug | undefined {
  if (!meta) return undefined
  return {
    batchStartMs: meta.batchStartMs,
    batchEndMs: meta.batchEndMs,
    batchMidMs: meta.batchMidMs,
    totalDurationMs: meta.totalDurationMs,
    batchMidRatio: meta.batchMidRatio,
    englishCenterIndex: meta.englishCenterIndex,
    windowStartSeg: meta.windowStartSeg,
    windowEndSeg: meta.windowEndSeg,
    windowTier: meta.windowTier,
    contextBeforeSegs: meta.contextBeforeSegs,
    contextAfterSegs: meta.contextAfterSegs,
    contextCharCount: meta.contextCharCount
  }
}

/** 小批调试：仅含必要诊断字段（不影响主流程）。 */
export interface SmallBatchAlignmentDebug {
  promptPreview: string
  rawResponse: string
  validationResult: string[]
  localEnglishExcerpt: string | null
  localEnglishContextPlain?: string | null
  timeRatioContext?: TimeRatioContextDebug
  missingSubtitleIdsInBatch?: number[]
  spanPairDiagnostics?: string[]
  spanOrderDiagnostics?: string[]
  spanResolutionDebugLines?: string[]
  /** 模型 matches 中逐项解析跳过的项（仍继续处理其余项）。 */
  modelParseWarnings?: AlignmentMatchParseWarning[]
}

export interface SmallBatchAlignmentSuccess {
  ok: true
  batch: SubtitleLine[]
  batchSubtitleIds: number[]
  candidateGroups: CandidateSegmentGroup[]
  validated: AlignmentMatchValidated[]
  applyable: AlignmentMatchRow[]
  report: ReturnType<typeof buildAlignmentReport>
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
  model: string
  batchSize?: number
  confidenceThresholdPct?: number
}

function countApplyable(batchSubtitleIds: number[], validated: AlignmentMatchValidated[]): number {
  let n = 0
  for (const id of batchSubtitleIds) {
    if (pickBestStructuralAIForSubtitle(validated, id)) n++
  }
  return n
}

function shouldEscalateContextWindow(
  batchSubtitleIds: number[],
  validated: AlignmentMatchValidated[]
): boolean {
  const n = batchSubtitleIds.length
  if (n === 0) return false
  const failed = n - countApplyable(batchSubtitleIds, validated)
  const threshold = Math.max(
    BATCH_CONTEXT_ESCALATE_FAILURE_MIN,
    Math.ceil(n * BATCH_CONTEXT_ESCALATE_FAILURE_RATIO)
  )
  return failed >= threshold
}

interface BatchAttemptSuccess {
  localEnglishContext: LocalEnglishContextBlock
  candidateGroups: CandidateSegmentGroup[]
  validated: AlignmentMatchValidated[]
  applyable: AlignmentMatchRow[]
  report: ReturnType<typeof buildAlignmentReport>
  promptPreview: string
  rawResponse: string
  validationResult: string[]
  missingSubtitleIdsInBatch: number[]
  spanPairDiagnostics: string[]
  spanOrderDiagnostics: string[]
  spanResolutionDebugLines: string[]
  modelParseWarnings: AlignmentMatchParseWarning[]
}

async function runSingleBatchAttempt(options: {
  batch: SubtitleLine[]
  engPool: ScriptSegment[]
  allSubtitles: SubtitleLine[]
  model: string
  tier: ContextWindowTier
  confidenceThresholdPct?: number
  alignmentPass?: AlignmentPromptPass
}): Promise<
  | { ok: true; data: BatchAttemptSuccess }
  | { ok: false; error: string; partial?: Partial<BatchAttemptSuccess> }
> {
  const { batch, engPool, allSubtitles, model, tier, confidenceThresholdPct, alignmentPass } = options
  const localEnglishContext = buildTimeRatioEnglishContextBlock({
    englishSegments: engPool,
    batch,
    allSubtitles,
    tier
  })

  if (!localEnglishContext) {
    return { ok: false, error: '无法构建时间比例英文上下文窗口。' }
  }

  if (alignmentPass === 'retry_coverage') {
    logRetryContextBeforeDeepSeek({
      tier,
      batchSubtitleIds: batch.map((b) => b.id),
      localEnglishContext
    })
  }

  const windowPool = engPool.slice(
    localEnglishContext.startSegmentIndex,
    localEnglishContext.endSegmentIndex + 1
  )
  const candidateGroups = buildDebugCandidateGroups({ englishSegments: windowPool })

  const promptSubs = batch.map((l, i) => ({
    subtitleId: l.id,
    orderIndex: i + 1,
    chinese: l.chinese
  }))

  const promptPreview = buildBatchAlignmentUserPayload({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext,
    alignmentPass: alignmentPass ?? 'standard'
  })

  const { messages } = buildBatchAlignmentPrompt({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext,
    alignmentPass: alignmentPass ?? 'standard'
  })

  const bridge = window.bilingualSubtitleAligner
  if (!bridge?.alignDeepSeekBatch) {
    return { ok: false, error: '真实对齐仅在 Electron 桌面端可用（安全桥接未加载）。' }
  }

  const api = await bridge.alignDeepSeekBatch({ model, messages })
  if (!api.ok) {
    if (alignmentPass === 'retry_coverage') {
      logRetryApiOrParseFailure({ tier, phase: 'bridge', error: api.error })
    }
    return { ok: false, error: api.error, partial: { promptPreview } }
  }

  const parsed = parseAlignmentModelJson(api.rawText)
  if (!parsed.ok) {
    if (alignmentPass === 'retry_coverage') {
      logRetryApiOrParseFailure({ tier, phase: 'parse', error: parsed.error, rawResponse: api.rawText })
    }
    return {
      ok: false,
      error: parsed.error,
      partial: { promptPreview, rawResponse: api.rawText }
    }
  }

  const batchSubtitleIds = batch.map((b) => b.id)
  const parseWarnings = parsed.data.parseWarnings
  const enriched = enrichAlignmentMatchesFromFullContext(
    parsed.data.matches,
    localEnglishContext,
    batchSubtitleIds
  )
  const rawValidated = validateAlignmentResult({
    result: enriched,
    localEnglishContext,
    expectedSubtitleIds: batchSubtitleIds
  })
  const { validated } = finalizeBatchAlignment(rawValidated)
  const chineseBySubtitleId = new Map(batch.map((b) => [b.id, b.chinese]))
  applyPostBatchSegmentationPolicy({
    validated,
    expectedSubtitleIds: batchSubtitleIds,
    chineseBySubtitleId,
    contextNorm: normalizeGroupText(localEnglishContext.text)
  })
  const parseWarningLines = parseWarnings.map(
    (w) =>
      `Invalid model item at matches[${w.index}]，已跳过该项。` +
      (w.subtitleId != null ? ` subtitleId=${w.subtitleId}.` : '') +
      ` ${w.reason}` +
      ` · raw≈ ${w.rawItemPreview.slice(0, 200)}${w.rawItemPreview.length > 200 ? '…' : ''}`
  )
  const debugPipeline = isAlignmentPipelineDebug()
  const validationResult = debugPipeline
    ? [...parseWarningLines, ...buildValidationWarnings(validated)]
    : parseWarningLines
  const missingSubtitleIdsInBatch = validated
    .filter((r) => r.validationFlags.includes('missing_subtitle'))
    .map((r) => r.subtitleId)
  const spanPairDiagnostics = debugPipeline
    ? buildSpanPairDiagnostics(validated, batchSubtitleIds)
    : []
  const spanOrderDiagnostics = debugPipeline
    ? buildSpanOrderDiagnostics(validated, batchSubtitleIds)
    : []
  const spanResolutionDebugLines = debugPipeline ? buildSpanResolutionDebugLines(validated) : []
  const applyable: AlignmentMatchRow[] = []
  for (const id of batchSubtitleIds) {
    const best = pickBestStructuralAIForSubtitle(validated, id)
    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      applyable.push(row)
    }
  }

  if (alignmentPass === 'retry_coverage') {
    logRetryTierModelOutcome({
      tier,
      batchSubtitleIds,
      rawResponse: api.rawText,
      validated,
      confidenceThresholdPct
    })
  }

  const report = buildAlignmentReport(batchSubtitleIds, validated, localEnglishContext.segmentIds, {
    confidenceThresholdPct
  })

  return {
    ok: true,
    data: {
      localEnglishContext,
      candidateGroups,
      validated,
      applyable,
      report,
      promptPreview,
      rawResponse: api.rawText,
      validationResult,
      missingSubtitleIdsInBatch,
      spanPairDiagnostics,
      spanOrderDiagnostics,
      spanResolutionDebugLines,
      modelParseWarnings: parseWarnings
    }
  }
}

export interface RunAlignmentBatchWithTimeRatioTiersInput {
  batch: SubtitleLine[]
  subtitles: SubtitleLine[]
  segments: ScriptSegment[]
  model: string
  tiers: ContextWindowTier[]
  alignmentPass: AlignmentPromptPass
  confidenceThresholdPct?: number
}

/** 显式一批字幕 + 指定时间比例窗口 tier 序列（首轮 [1,2,3]、Retry [4,3] 等）。 */
export async function runAlignmentBatchWithTimeRatioTiers(
  input: RunAlignmentBatchWithTimeRatioTiersInput
): Promise<SmallBatchAlignmentResult> {
  const { batch, subtitles, segments, model, tiers, alignmentPass, confidenceThresholdPct } = input
  if (batch.length === 0) {
    return { ok: false, error: '内部分批为空。', debug: null }
  }

  const engPool = filterEnglishPoolSegments(segments)
  if (engPool.length === 0) {
    return {
      ok: false,
      error: '没有符合「英文标签 + 纯英文文本」的 Script Pool 片段。请检查英文稿。',
      debug: null
    }
  }

  const firstTier = tiers[0]!
  let best: BatchAttemptSuccess | null = null
  let bestApplyable = -1
  let lastError: string | null = null
  let lastPartial: Partial<BatchAttemptSuccess> = {}
  const escalationNotes: string[] = []

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!
    const attempt = await runSingleBatchAttempt({
      batch,
      engPool,
      allSubtitles: subtitles,
      model,
      tier,
      confidenceThresholdPct,
      alignmentPass
    })

    if (!attempt.ok) {
      lastError = attempt.error
      lastPartial = attempt.partial ?? {}
      if (tier === firstTier) {
        return {
          ok: false,
          error: attempt.error,
          debug: {
            promptPreview: lastPartial.promptPreview ?? '',
            rawResponse: lastPartial.rawResponse ?? '',
            validationResult: [attempt.error],
            localEnglishExcerpt: null
          }
        }
      }
      break
    }

    const data = attempt.data
    const applyableCount = countApplyable(
      batch.map((b) => b.id),
      data.validated
    )
    if (applyableCount > bestApplyable) {
      bestApplyable = applyableCount
      best = data
    }

    if (i > 0) {
      escalationNotes.push(`expanded to tier ${tier}`)
    }

    const batchIds = batch.map((b) => b.id)
    if (!shouldEscalateContextWindow(batchIds, data.validated)) {
      best = data
      break
    }
    if (i < tiers.length - 1) {
      escalationNotes.push(`tier ${tier} failure-heavy → retry wider context`)
    }
  }

  if (!best) {
    return {
      ok: false,
      error: lastError ?? '对齐失败。',
      debug: {
        promptPreview: lastPartial.promptPreview ?? '',
        rawResponse: lastPartial.rawResponse ?? '',
        validationResult: lastError ? [lastError] : [],
        localEnglishExcerpt: null
      }
    }
  }

  const localEnglishContext = best.localEnglishContext
  const localEnglishExcerpt = excerptText(localEnglishContext.text, 600)
  const timeRatioBase = timeRatioDebugFromMeta(localEnglishContext.timeRatio)
  const timeRatioContext: TimeRatioContextDebug | undefined = timeRatioBase
    ? {
        ...timeRatioBase,
        windowEscalation: escalationNotes.length ? escalationNotes.join('; ') : undefined
      }
    : undefined

  if (escalationNotes.length) {
    best.validationResult.push(`context_window: ${escalationNotes.join('; ')}`)
  }

  return {
    ok: true,
    batch,
    batchSubtitleIds: batch.map((b) => b.id),
    candidateGroups: best.candidateGroups,
    validated: best.validated,
    applyable: best.applyable,
    report: best.report,
    englishPoolSize: engPool.length,
    debug: {
      promptPreview: best.promptPreview,
      rawResponse: best.rawResponse,
      validationResult: best.validationResult,
      localEnglishExcerpt,
      localEnglishContextPlain: isAlignmentPipelineDebug()
        ? excerptText(localEnglishContext.text, 8000)
        : undefined,
      timeRatioContext,
      missingSubtitleIdsInBatch: best.missingSubtitleIdsInBatch,
      spanPairDiagnostics: best.spanPairDiagnostics,
      spanOrderDiagnostics: best.spanOrderDiagnostics,
      spanResolutionDebugLines: best.spanResolutionDebugLines,
      modelParseWarnings: best.modelParseWarnings
    }
  }
}

export async function runSmallBatchAlignment(
  input: RunSmallBatchAlignmentInput
): Promise<SmallBatchAlignmentResult> {
  const batch = pickSmallBatchSubtitles(
    input.subtitles,
    input.currentSubtitleId,
    input.batchSize
  )
  if (batch.length === 0) {
    return { ok: false, error: '没有可对齐的中文字幕。请先导入 SRT。', debug: null }
  }

  return runAlignmentBatchWithTimeRatioTiers({
    batch,
    subtitles: input.subtitles,
    segments: input.segments,
    model: input.model,
    tiers: [1, 2, 3],
    alignmentPass: 'standard',
    confidenceThresholdPct: input.confidenceThresholdPct
  })
}
