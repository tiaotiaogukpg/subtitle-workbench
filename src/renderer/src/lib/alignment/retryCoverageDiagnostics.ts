import { isStructuralAIWritable, pickBestStructuralAIForSubtitle } from './applyPolicy'
import type { LocalEnglishContextBlock } from './englishBlock'
import { ALIGNMENT_HARD_BLOCK_FLAGS } from './matchFlags'
import type { ContextWindowTier } from './timeRatioContext'
import { confidenceToPercent, type AlignmentMatchValidated } from './types'
import type { SubtitleLine } from '../../types'
import { useUiSettingsStore } from '../../store/uiSettingsStore'

const TAG = '[retry-coverage]'

const CONTEXT_HEAD = 420
const CONTEXT_TAIL = 420

function logDebugEnabled(): boolean {
  return useUiSettingsStore.getState().debugMode
}

function rawJsonLikelyContainsSubtitleId(raw: string, subtitleId: number): boolean {
  return new RegExp(`"subtitleId"\\s*:\\s*${subtitleId}\\b`).test(raw)
}

function firstHardBlock(flags: AlignmentMatchValidated['validationFlags']): string | null {
  for (const f of flags) {
    if (ALIGNMENT_HARD_BLOCK_FLAGS.includes(f)) return f
  }
  return null
}

/** 1. 进入 retry 目标列表的全部字幕快照 */
export function logRetryTargetList(targets: SubtitleLine[]): void {
  if (!logDebugEnabled()) return
  if (targets.length === 0) {
    console.info(TAG, '1.target-list', { total: 0, items: [] })
    return
  }
  console.info(TAG, '1.target-list', {
    total: targets.length,
    items: targets.map((l) => ({
      subtitleId: l.id,
      status: l.status,
      englishEmpty: !l.english.trim(),
      englishLen: l.english.trim().length,
      problems: [...l.problems],
      chinesePreview: l.chinese.slice(0, 200)
    }))
  })
}

/** 2b. 模板 batch 经 isRetryCoverageTarget 过滤后为空 */
export function logRetryBatchFilteredEmpty(templateIds: number[]): void {
  if (!logDebugEnabled()) return
  console.info(TAG, '2b.batch-filtered-empty', {
    templateIds,
    hint: '这些 id 在入批时已不再是 retry 目标（例如已写入或状态变化）'
  })
}

/** 2. 本批实际送入 DeepSeek 的字幕 */
export function logRetryBatchComposition(batch: SubtitleLine[]): void {
  if (!logDebugEnabled()) return
  console.info(TAG, '2.batch', {
    count: batch.length,
    subtitleIds: batch.map((l) => l.id),
    lines: batch.map((l) => ({
      subtitleId: l.id,
      status: l.status,
      englishEmpty: !l.english.trim(),
      problems: [...l.problems],
      chinesePreview: l.chinese.slice(0, 240)
    }))
  })
}

/** 3. 本 tier 构建的英文上下文（调用 DeepSeek 之前） */
export function logRetryContextBeforeDeepSeek(input: {
  tier: ContextWindowTier
  batchSubtitleIds: number[]
  localEnglishContext: LocalEnglishContextBlock
  /** 可选：在控制台核对某句是否在窗口内（例如 "And I went to Bodyguard"） */
  phraseContains?: string[]
}): void {
  if (!logDebugEnabled()) return
  const text = input.localEnglishContext.text
  const tr = input.localEnglishContext.timeRatio
  const checks: Record<string, boolean> = {}
  for (const p of input.phraseContains ?? []) {
    const q = p.trim()
    if (q) checks[q] = text.includes(q)
  }
  console.info(TAG, '3.context-before-deepseek', {
    tier: input.tier,
    batchSubtitleIds: input.batchSubtitleIds,
    poolSegmentRange: tr
      ? { windowStartSeg: tr.windowStartSeg, windowEndSeg: tr.windowEndSeg, englishCenterIndex: tr.englishCenterIndex }
      : {
          startSegmentIndex: input.localEnglishContext.startSegmentIndex,
          endSegmentIndex: input.localEnglishContext.endSegmentIndex
        },
    contextCharCount: text.length,
    phraseContains: Object.keys(checks).length ? checks : undefined,
    contextExcerptHead: text.slice(0, CONTEXT_HEAD),
    contextExcerptTail: text.length > CONTEXT_HEAD + CONTEXT_TAIL ? text.slice(-CONTEXT_TAIL) : undefined
  })
}

/** 4–5. 单次 tier 调用后：原始 JSON 是否提到 id、校验行、可写性、为何 pickBest 为空 */
export function logRetryTierModelOutcome(input: {
  tier: ContextWindowTier
  batchSubtitleIds: number[]
  rawResponse: string
  validated: AlignmentMatchValidated[]
  confidenceThresholdPct?: number
}): void {
  if (!logDebugEnabled()) return
  const { tier, batchSubtitleIds, rawResponse, validated, confidenceThresholdPct } = input
  const rawHead = rawResponse.slice(0, 720)
  const rawTail = rawResponse.length > 2000 ? rawResponse.slice(-720) : undefined

  console.info(TAG, '4.raw-response-excerpt', { tier, rawHead, rawTail })

  for (const subtitleId of batchSubtitleIds) {
    const mentioned = rawJsonLikelyContainsSubtitleId(rawResponse, subtitleId)
    const rowsAll = validated.filter((r) => r.subtitleId === subtitleId)
    const rows = rowsAll.filter((r) => !r.validationFlags.includes('missing_subtitle'))
    const best = pickBestStructuralAIForSubtitle(validated, subtitleId)

    let structuralDiagnosis: Record<string, unknown> | null = null
    const candidates = rows.length > 0 ? rows : rowsAll
    if (candidates.length > 0) {
      const top = [...candidates].sort((a, b) => b.confidence - a.confidence)[0]!
      const writable = isStructuralAIWritable(top)
      structuralDiagnosis = {
        topConfidencePct: confidenceToPercent(top.confidence),
        thresholdPct: confidenceThresholdPct ?? null,
        topApplyableField: top.applyable,
        topStructurallyWritable: writable,
        topValidationFlags: [...top.validationFlags],
        firstHardBlock: firstHardBlock(top.validationFlags),
        topEnglishPreview: top.english.slice(0, 200),
        topSpanLocal:
          top.spanStart != null && top.spanEnd != null ? [top.spanStart, top.spanEnd] : null,
        topDeclaredSpan:
          top.declaredSpanStart != null && top.declaredSpanEnd != null
            ? [top.declaredSpanStart, top.declaredSpanEnd]
            : null,
        whyPickBestNull:
          best == null
            ? writable
              ? 'unexpected: structurally writable but not picked (check pickBestStructuralAIForSubtitle)'
              : `not structurally writable; see firstHardBlock / topValidationFlags`
            : null
      }
    }

    console.info(TAG, '5.subtitle-after-validate', {
      tier,
      subtitleId,
      rawResponseLikelyContainsSubtitleId: mentioned,
      validatedRowCount: rowsAll.length,
      nonMissingRowCount: rows.length,
      pickBestStructural: best
        ? {
            english: best.english.slice(0, 400),
            spanStart: best.spanStart,
            spanEnd: best.spanEnd,
            confidence: best.confidence,
            confidencePct: confidenceToPercent(best.confidence),
            validationFlags: [...best.validationFlags],
            applyableField: best.applyable
          }
        : null,
      allRowsForSubtitle: rowsAll.map((r) => ({
        applyable: r.applyable,
        validationFlags: [...r.validationFlags],
        englishPreview: r.english.slice(0, 160),
        spanStart: r.spanStart,
        spanEnd: r.spanEnd
      })),
      structuralDiagnosis
    })

    if (!mentioned && rowsAll.length === 0) {
      console.info(TAG, '6.hint', {
        subtitleId,
        tier,
        hint: '原始 JSON 中未出现该 subtitleId，且校验结果无该行 — 可能模型漏返回或 JSON 解析异常'
      })
    }
  }
}

export function logRetryApiOrParseFailure(input: {
  tier: ContextWindowTier
  phase: 'bridge' | 'parse'
  error: string
  rawResponse?: string
}): void {
  if (!logDebugEnabled()) return
  console.warn(TAG, 'api-or-parse-failure', {
    tier: input.tier,
    phase: input.phase,
    error: input.error,
    rawResponseExcerpt: input.rawResponse?.slice(0, 800)
  })
}
