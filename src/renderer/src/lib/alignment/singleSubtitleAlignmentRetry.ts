import { useSubtitleStore } from '../../store/subtitleStore'
import type { ScriptSegment, SubtitleAiAttempt, SubtitleAiAttemptSource, SubtitleLine } from '../../types'
import {
  buildAiAttemptPayloadFromWritableRow,
  buildFailedAiAttemptPayload
} from './aiAttempts'
import {
  diagnosticProblemsForFailedAlignment,
  pickBestStructuralAIForSubtitle,
  readableProblemsForAIRow
} from './applyPolicy'
import { isActiveRun } from './operationGuard'
import { runAlignmentBatchWithTimeRatioTiers } from './smallBatchPipeline'

export interface RunSingleSubtitleAlignmentRetryInput {
  line: SubtitleLine
  subtitles: SubtitleLine[]
  segments: ScriptSegment[]
  model: string
  confidenceThresholdPct: number
  /** false：与整文件首轮相同 tier 序列；true：与 Retry Coverage 相同的大窗 + prompt。 */
  wide: boolean
  /** 覆盖默认 single_retry / wide_retry，用于 batch 等来源标签。 */
  attemptSource?: SubtitleAiAttemptSource
  /** 由 operationGuard 分配；过期或已 cancel 时不写入 store。 */
  guardRunId?: number
}

export type RunSingleSubtitleAlignmentRetryResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * 单行重试：结果仅追加到 `aiAttempts`，不修改当前 `english`（含 confirmed/manual）。
 */
export async function runSingleSubtitleAlignmentRetry(
  input: RunSingleSubtitleAlignmentRetryInput
): Promise<RunSingleSubtitleAlignmentRetryResult> {
  const { line, subtitles, segments, model, confidenceThresholdPct, wide, attemptSource: sourceOverride, guardRunId } =
    input
  const source: SubtitleAiAttemptSource =
    sourceOverride ?? (wide ? ('wide_retry' as const) : ('single_retry' as const))

  if (guardRunId !== undefined && !isActiveRun(guardRunId)) {
    return { ok: false, error: '任务已停止' }
  }

  const result = await runAlignmentBatchWithTimeRatioTiers({
    batch: [line],
    subtitles,
    segments,
    model,
    tiers: wide ? [4, 3] : [1, 2, 3],
    alignmentPass: wide ? 'retry_coverage' : 'standard',
    confidenceThresholdPct
  })

  const tier = result.ok ? result.debug.timeRatioContext?.windowTier : undefined

  if (guardRunId !== undefined && !isActiveRun(guardRunId)) {
    return { ok: false, error: '任务已停止' }
  }

  const append = (payload: Omit<SubtitleAiAttempt, 'id' | 'createdAt'>): void => {
    if (guardRunId !== undefined && !isActiveRun(guardRunId)) return
    useSubtitleStore.getState().appendSubtitleAiAttempts([{ subtitleId: line.id, attempt: payload }])
  }

  if (!result.ok) {
    append(
      buildFailedAiAttemptPayload({
        source,
        problems: [result.error],
        contextTier: tier,
        reason: 'alignment_request_failed'
      })
    )
    return { ok: false, error: result.error }
  }

  const validated = result.validated
  const rowsForSub = validated.filter((v) => v.subtitleId === line.id)
  const best = pickBestStructuralAIForSubtitle(validated, line.id)

  if (best) {
    const problems = readableProblemsForAIRow(best, confidenceThresholdPct)
    const payload = buildAiAttemptPayloadFromWritableRow(best, {
      source,
      contextTier: tier,
      thresholdPct: confidenceThresholdPct,
      problems
    })
    append(payload)
    return { ok: true }
  }

  const probs = diagnosticProblemsForFailedAlignment(rowsForSub)
  append(
    buildFailedAiAttemptPayload({
      source,
      problems: probs.length ? probs : ['ai_alignment:no_match'],
      contextTier: tier,
      reason: 'no_applyable_structural_match'
    })
  )
  return { ok: true }
}
