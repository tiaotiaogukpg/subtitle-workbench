import type { CandidateSegmentGroup, ScriptSegment, SubtitleLine } from '../../types'
import { pickSmallBatchSubtitles } from './batchSelection'
import { buildDebugCandidateGroups } from './candidateGroups'
import { enrichAlignmentMatchesFromFullContext } from './contextEnrichment'
import { buildAlignmentReport } from './completeness'
import { buildFullFileEnglishContextBlock } from './englishBlock'
import { filterEnglishPoolSegments } from './englishPool'
import {
  buildBatchAlignmentPrompt,
  buildBatchAlignmentUserPayload,
  parseAlignmentModelJson
} from './promptBuilder'
import type { AlignmentMatchRow, AlignmentMatchValidated } from './types'
import { pickBestStructuralAIForSubtitle } from './applyPolicy'
import { finalizeBatchAlignment } from './sequentialAlignment'
import {
  buildSpanOrderDiagnostics,
  buildSpanPairDiagnostics,
  buildValidationWarnings,
  validateAlignmentResult
} from './validation'

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

/** 小批调试：仅含必要诊断字段（不影响主流程）。 */
export interface SmallBatchAlignmentDebug {
  promptPreview: string
  rawResponse: string
  validationResult: string[]
  localEnglishExcerpt: string | null
  /** 较长摘录：便于对照 span 与原文（已截断）。 */
  localEnglishContextPlain?: string | null
  missingSubtitleIdsInBatch?: number[]
  spanPairDiagnostics?: string[]
  spanOrderDiagnostics?: string[]
  spanResolutionDebugLines?: string[]
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

  const localEnglishContext = buildFullFileEnglishContextBlock(engPool)
  const localEnglishExcerpt = excerptText(localEnglishContext?.text, 600)

  const promptSubs = batch.map((l, i) => ({
    subtitleId: l.id,
    orderIndex: i + 1,
    chinese: l.chinese
  }))

  if (!localEnglishContext) {
    return {
      ok: false,
      error: '无法构建整稿英文上下文（需连续可解析的纯英文 Script Pool 片段）。',
      debug: {
        promptPreview: '',
        rawResponse: '',
        validationResult: ['No englishContext block.'],
        localEnglishExcerpt
      }
    }
  }

  const candidateGroups = buildDebugCandidateGroups({ englishSegments: engPool })

  const promptPreview = buildBatchAlignmentUserPayload({
    subtitles: promptSubs,
    candidateGroups,
    localEnglishContext
  })

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
  const validationResult = [...buildValidationWarnings(validated)]
  const missingSubtitleIdsInBatch = validated
    .filter((r) => r.validationFlags.includes('missing_subtitle'))
    .map((r) => r.subtitleId)
  const spanPairDiagnostics = buildSpanPairDiagnostics(validated)
  const spanOrderDiagnostics = buildSpanOrderDiagnostics(validated, batchSubtitleIds)
  const spanResolutionDebugLines = buildSpanResolutionDebugLines(validated)
  const applyable: AlignmentMatchRow[] = []
  for (const id of batchSubtitleIds) {
    const best = pickBestStructuralAIForSubtitle(validated, id)
    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      applyable.push(row)
    }
  }

  const report = buildAlignmentReport(batchSubtitleIds, validated, localEnglishContext.segmentIds, {
    confidenceThresholdPct: input.confidenceThresholdPct
  })

  return {
    ok: true,
    batch,
    batchSubtitleIds,
    candidateGroups,
    validated,
    applyable,
    report,
    englishPoolSize: engPool.length,
    debug: {
      promptPreview,
      rawResponse: api.rawText,
      validationResult,
      localEnglishExcerpt,
      localEnglishContextPlain: excerptText(localEnglishContext.text, 8000),
      missingSubtitleIdsInBatch,
      spanPairDiagnostics,
      spanOrderDiagnostics,
      spanResolutionDebugLines
    }
  }
}
