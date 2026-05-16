import {
  buildCandidatesForSubtitle,
  deriveStatusAfterAI,
  diagnosticProblemsForFailedAlignment,
  pickBestStructuralAIForSubtitle,
  readableProblemsForAIRow
} from './applyPolicy'
import { pickSubtitleBatchSlice } from './batchSelection'
import { buildFullFileAlignmentReport } from './completeness'
import { filterEnglishPoolSegments } from './englishPool'
import { validateAlignmentPrerequisites } from './prerequisites'
import {
  AI_ALIGNMENT_NO_MATCH_AFTER_RETRY,
  collectRetryCoverageTargetsInOrder,
  isRetryCoverageTarget
} from './retryCoverageEligibility'
import {
  logRetryBatchComposition,
  logRetryBatchFilteredEmpty,
  logRetryTargetList
} from './retryCoverageDiagnostics'
import { runRetryCoverageAlignmentBatch } from './retryCoveragePass'
import { runSmallBatchAlignment } from './smallBatchPipeline'
import type { AlignmentMatchValidated } from './types'
import { buildFailedAiAttemptPayload } from './aiAttempts'
import { useAlignmentPreviewStore } from '../../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../../store/alignmentSessionStore'
import { useScriptPoolStore } from '../../store/scriptPoolStore'
import { useSubtitleStore } from '../../store/subtitleStore'
import { useUiSettingsStore } from '../../store/uiSettingsStore'
import type { AiAlignmentRunConfig, SubtitleLine, SubtitleStatus } from '../../types'

let runGeneration = 0

function countBatchStats(
  batchSubtitleIds: number[],
  validated: AlignmentMatchValidated[],
  thresholdPct: number
): { matched: number; needsReview: number; failed: number } {
  let matched = 0
  let needsReview = 0
  let failed = 0
  for (const subtitleId of batchSubtitleIds) {
    const rows = validated.filter((v) => v.subtitleId === subtitleId)
    const best = pickBestStructuralAIForSubtitle(validated, subtitleId)
    if (!best) {
      if (rows.some((r) => r.validationFlags.includes('semantic_undersegmentation'))) {
        needsReview++
      } else {
        failed++
      }
      continue
    }
    matched++
    const st = deriveStatusAfterAI(best, thresholdPct)
    if (st !== 'confirmed') needsReview++
  }
  return { matched, needsReview, failed }
}

function applyFullFileBatchResults(
  batchSubtitleIds: number[],
  validated: AlignmentMatchValidated[],
  thresholdPct: number,
  attemptMeta: { attemptSource: 'initial' | 'retry'; contextTier?: number }
): import('./types').AlignmentMatchRow[] {
  const subtitleStore = useSubtitleStore.getState()
  const aiEntries: Array<{
    subtitleId: number
    primary: import('./types').AlignmentMatchRow
    status: SubtitleStatus
    problems: string[]
    candidates: import('../../types').CandidateMatch[]
    attemptBestValidated: AlignmentMatchValidated
    attemptSource: 'initial' | 'retry'
    attemptContextTier?: number
  }> = []
  const linesWithoutAiWrite: Array<{
    subtitleId: number
    candidates?: import('../../types').CandidateMatch[]
    problems: string[]
    clearEnglish?: boolean
  }> = []

  for (const subtitleId of batchSubtitleIds) {
    const rowsForSub = validated.filter((v) => v.subtitleId === subtitleId)
    const best = pickBestStructuralAIForSubtitle(validated, subtitleId)

    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      const status = deriveStatusAfterAI(best, thresholdPct)
      const problems = readableProblemsForAIRow(best, thresholdPct)
      const candidates = buildCandidatesForSubtitle(rowsForSub, best)
      aiEntries.push({
        subtitleId,
        primary: row,
        status,
        problems,
        candidates,
        attemptBestValidated: best,
        attemptSource: attemptMeta.attemptSource,
        attemptContextTier: attemptMeta.contextTier
      })
    } else {
      const probs = diagnosticProblemsForFailedAlignment(rowsForSub)
      linesWithoutAiWrite.push({
        subtitleId,
        candidates: buildCandidatesForSubtitle(rowsForSub, null),
        problems: probs,
        clearEnglish: rowsForSub.some((r) => r.validationFlags.includes('semantic_undersegmentation'))
      })
    }
  }

  if (aiEntries.length > 0) {
    subtitleStore.applyFullFileAIMatchBatch(aiEntries, thresholdPct)
  }
  if (linesWithoutAiWrite.length > 0) {
    const skip = new Set(aiEntries.map((e) => e.subtitleId))
    const onlyReview = linesWithoutAiWrite.filter((f) => !skip.has(f.subtitleId))
    if (onlyReview.length > 0) {
      subtitleStore.applyAlignmentReviewStates(onlyReview)
      subtitleStore.appendSubtitleAiAttempts(
        onlyReview.map((f) => ({
          subtitleId: f.subtitleId,
          attempt: buildFailedAiAttemptPayload({
            source: attemptMeta.attemptSource,
            problems: f.problems,
            contextTier: attemptMeta.contextTier,
            reason: 'no_applyable_structural_match'
          })
        }))
      )
    }
  }

  return aiEntries.map((e) => e.primary)
}

function applyRetryCoverageBatchResults(
  batchSubtitleIds: number[],
  validated: AlignmentMatchValidated[],
  thresholdPct: number,
  attemptMeta: { attemptSource: 'initial' | 'retry'; contextTier?: number }
): number {
  const subtitleStore = useSubtitleStore.getState()
  const subtitles = subtitleStore.subtitles
  const aiEntries: Array<{
    subtitleId: number
    primary: import('./types').AlignmentMatchRow
    status: SubtitleStatus
    problems: string[]
    candidates: import('../../types').CandidateMatch[]
    attemptBestValidated: AlignmentMatchValidated
    attemptSource: 'initial' | 'retry'
    attemptContextTier?: number
  }> = []
  const linesWithoutAiWrite: Array<{
    subtitleId: number
    candidates?: import('../../types').CandidateMatch[]
    problems: string[]
    clearEnglish?: boolean
  }> = []

  for (const subtitleId of batchSubtitleIds) {
    const line = subtitles.find((l) => l.id === subtitleId)
    if (line?.status === 'confirmed' || line?.status === 'manual') continue

    const rowsForSub = validated.filter((v) => v.subtitleId === subtitleId)
    const best = pickBestStructuralAIForSubtitle(validated, subtitleId)

    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      const status = deriveStatusAfterAI(best, thresholdPct)
      const problems = readableProblemsForAIRow(best, thresholdPct)
      const candidates = buildCandidatesForSubtitle(rowsForSub, best)
      aiEntries.push({
        subtitleId,
        primary: row,
        status,
        problems,
        candidates,
        attemptBestValidated: best,
        attemptSource: attemptMeta.attemptSource,
        attemptContextTier: attemptMeta.contextTier
      })
    } else {
      let probs = diagnosticProblemsForFailedAlignment(rowsForSub)
      const isSemantic = rowsForSub.some((r) => r.validationFlags.includes('semantic_undersegmentation'))
      if (!isSemantic && probs[0] === 'ai_alignment:no_match') {
        probs = [AI_ALIGNMENT_NO_MATCH_AFTER_RETRY]
      }
      linesWithoutAiWrite.push({
        subtitleId,
        candidates: buildCandidatesForSubtitle(rowsForSub, null),
        problems: probs,
        clearEnglish: isSemantic
      })
    }
  }

  if (aiEntries.length > 0) {
    subtitleStore.applyRetryCoverageMatchBatch(aiEntries, thresholdPct)
  }
  if (linesWithoutAiWrite.length > 0) {
    const skip = new Set(aiEntries.map((e) => e.subtitleId))
    const onlyReview = linesWithoutAiWrite.filter((f) => !skip.has(f.subtitleId))
    if (onlyReview.length > 0) {
      subtitleStore.applyAlignmentReviewStates(onlyReview)
      subtitleStore.appendSubtitleAiAttempts(
        onlyReview.map((f) => ({
          subtitleId: f.subtitleId,
          attempt: buildFailedAiAttemptPayload({
            source: attemptMeta.attemptSource,
            problems: f.problems,
            contextTier: attemptMeta.contextTier,
            reason: 'no_applyable_structural_match'
          })
        }))
      )
    }
  }

  return aiEntries.length
}

async function runFullFileAlignment(
  config: AiAlignmentRunConfig,
  generation: number,
  resume?: {
    subtitleStart: number
    batchIndexBeforeIncrement: number
  }
): Promise<void> {
  const session = useAlignmentSessionStore.getState()
  const subtitles = useSubtitleStore.getState().subtitles
  const segments = useScriptPoolStore.getState().segments
  const batchSize = config.batchSize
  const totalBatches = Math.max(1, Math.ceil(subtitles.length / batchSize))

  let subtitleStart = resume?.subtitleStart ?? 0
  let batchIndex = resume?.batchIndexBeforeIncrement ?? 0

  while (subtitleStart < subtitles.length) {
    if (generation !== runGeneration) return
    const sessionNow = useAlignmentSessionStore.getState()
    if (sessionNow.status === 'paused') {
      await new Promise((r) => setTimeout(r, 200))
      continue
    }
    if (sessionNow.status !== 'running') return

    const batch = pickSubtitleBatchSlice(subtitles, subtitleStart, batchSize)
    if (batch.length === 0) break

    batchIndex++
    const batchLabel = `#${batch[0]!.id}–#${batch[batch.length - 1]!.id}`

    session.noteBatchProgress({
      batchIndex,
      totalBatches,
      batchLabel,
      processingSubtitleId: batch[0]!.id,
      processedSubtitleCount: subtitleStart,
      matchedDelta: 0,
      needsReviewDelta: 0,
      failedDelta: 0
    })

    const result = await runSmallBatchAlignment({
      subtitles,
      currentSubtitleId: batch[0]!.id,
      segments,
      model: config.model,
      batchSize: batch.length,
      confidenceThresholdPct: config.confidenceThreshold
    })

    if (generation !== runGeneration) return

    if (!result.ok) {
      useAlignmentPreviewStore.getState().setRunError(result.error, result.debug)
      session.failSession(result.error)
      return
    }

    applyFullFileBatchResults(result.batchSubtitleIds, result.validated, config.confidenceThreshold, {
      attemptSource: 'initial',
      contextTier: result.debug.timeRatioContext?.windowTier
    })

    const stats = countBatchStats(
      result.batchSubtitleIds,
      result.validated,
      config.confidenceThreshold
    )

    useAlignmentPreviewStore.getState().setSuccess({
      validated: result.validated,
      applyable: result.applyable,
      candidateGroups: result.candidateGroups,
      batchSubtitleIds: result.batchSubtitleIds,
      report: result.report,
      debug: result.debug
    })

    session.noteBatchProgress({
      batchIndex,
      totalBatches,
      batchLabel,
      processingSubtitleId: null,
      processedSubtitleCount: subtitleStart + batch.length,
      matchedDelta: stats.matched,
      needsReviewDelta: stats.needsReview,
      failedDelta: stats.failed
    })

    subtitleStart += batch.length
  }

  if (generation !== runGeneration) return

  const subtitlesAfterFirst = useSubtitleStore.getState().subtitles
  const firstPassMatchedCount = subtitlesAfterFirst.filter(
    (l) => l.english.trim() && (l.status === 'confirmed' || l.status === 'low_confidence')
  ).length

  const initialRetryTargets = collectRetryCoverageTargetsInOrder(subtitlesAfterFirst)
  logRetryTargetList(initialRetryTargets)

  if (initialRetryTargets.length === 0) {
    useAlignmentSessionStore.getState().patchProgress({
      coverageRetryPhase: 'completed',
      firstPassMatchedCount,
      retryMatchedDeltaCount: 0,
      retryStillNeedsReviewCount: 0
    })
  } else {
    useAlignmentSessionStore.getState().patchProgress({
      coverageRetryPhase: 'running',
      firstPassMatchedCount,
      retryMatchedDeltaCount: 0,
      retryStillNeedsReviewCount: 0
    })

    const batchSize = config.batchSize
    for (let batchStart = 0, rb = 0; batchStart < initialRetryTargets.length; batchStart += batchSize) {
      if (generation !== runGeneration) return
      let sessionLoop = useAlignmentSessionStore.getState()
      while (sessionLoop.status === 'paused') {
        await new Promise((r) => setTimeout(r, 200))
        if (generation !== runGeneration) return
        sessionLoop = useAlignmentSessionStore.getState()
      }
      if (sessionLoop.status !== 'running') return

      const batchTemplate = initialRetryTargets.slice(batchStart, batchStart + batchSize)
      const freshSubtitles = useSubtitleStore.getState().subtitles
      const batch = batchTemplate
        .map((t) => freshSubtitles.find((l) => l.id === t.id))
        .filter((l): l is SubtitleLine => Boolean(l))
        .filter(isRetryCoverageTarget)

      if (batch.length === 0) {
        logRetryBatchFilteredEmpty(batchTemplate.map((t) => t.id))
        continue
      }

      rb++
      const totalRetryBatches = Math.max(1, Math.ceil(initialRetryTargets.length / batchSize))
      logRetryBatchComposition(batch)
      useAlignmentSessionStore.getState().noteBatchProgress({
        batchIndex: totalBatches,
        totalBatches,
        batchLabel: `Retry ${rb}/${totalRetryBatches} · #${batch[0]!.id}–#${batch[batch.length - 1]!.id}`,
        processingSubtitleId: batch[0]!.id,
        processedSubtitleCount: subtitles.length,
        matchedDelta: 0,
        needsReviewDelta: 0,
        failedDelta: 0
      })

      const result = await runRetryCoverageAlignmentBatch({
        batch,
        subtitles: useSubtitleStore.getState().subtitles,
        segments,
        model: config.model,
        confidenceThresholdPct: config.confidenceThreshold
      })

      if (generation !== runGeneration) return

      if (!result.ok) {
        useAlignmentPreviewStore.getState().setRunError(result.error, result.debug)
        useAlignmentSessionStore.getState().failSession(result.error)
        return
      }

      const written = applyRetryCoverageBatchResults(
        result.batchSubtitleIds,
        result.validated,
        config.confidenceThreshold,
        {
          attemptSource: 'retry',
          contextTier: result.debug.timeRatioContext?.windowTier
        }
      )
      if (useUiSettingsStore.getState().debugMode) {
        console.info('[retry-coverage]', 'apply.after-batch', {
          written,
          batchSubtitleIds: result.batchSubtitleIds
        })
      }

      useAlignmentPreviewStore.getState().setSuccess({
        validated: result.validated,
        applyable: result.applyable,
        candidateGroups: result.candidateGroups,
        batchSubtitleIds: result.batchSubtitleIds,
        report: result.report,
        debug: result.debug
      })

      const s = useAlignmentSessionStore.getState()
      s.patchProgress({
        retryMatchedDeltaCount: s.retryMatchedDeltaCount + written,
        processingSubtitleId: null
      })
    }

    const still = collectRetryCoverageTargetsInOrder(useSubtitleStore.getState().subtitles).length
    useAlignmentSessionStore.getState().patchProgress({
      coverageRetryPhase: 'completed',
      retryStillNeedsReviewCount: still
    })
  }

  if (generation !== runGeneration) return

  const finalReport = buildFullFileAlignmentReport({
    subtitles: useSubtitleStore.getState().subtitles,
    segments: useScriptPoolStore.getState().segments,
    duplicateSegmentIds: []
  })

  const sessionDone = useAlignmentSessionStore.getState()
  sessionDone.completeSession(
    `整文件完成 · 首轮较好匹配约 ${sessionDone.firstPassMatchedCount} 条 · Retry 补齐 ${sessionDone.retryMatchedDeltaCount} 条 · 仍待复查约 ${sessionDone.retryStillNeedsReviewCount} 条 · 报告：已匹配 ${finalReport.matchedSubtitleCount}/${finalReport.totalSubtitleCount} · 需复查 ${finalReport.needsReviewCount} · 未匹配 ${finalReport.unmatchedCount}`,
    finalReport
  )
}

export function startAlignmentSession(config: AiAlignmentRunConfig, apiKey: string): string | null {
  const blocked = validateAlignmentPrerequisites({
    apiKey,
    subtitleCount: useSubtitleStore.getState().subtitles.length,
    englishPoolSize: filterEnglishPoolSegments(useScriptPoolStore.getState().segments).length,
    bridgeReady: Boolean(window.bilingualSubtitleAligner?.alignDeepSeekBatch)
  })
  if (blocked) return blocked

  const status = useAlignmentSessionStore.getState().status
  if (status === 'running' || status === 'paused') {
    return '已有对齐任务正在运行。'
  }

  const subtitles = useSubtitleStore.getState().subtitles
  const totalBatches = Math.max(1, Math.ceil(subtitles.length / config.batchSize))

  runGeneration += 1
  const generation = runGeneration

  useAlignmentSessionStore.getState().beginSession(config, subtitles.length, totalBatches)
  useAlignmentPreviewStore.getState().startLoading()

  void (async () => {
    try {
      await runFullFileAlignment(config, generation)
    } catch (e) {
      if (generation !== runGeneration) return
      const msg = e instanceof Error ? e.message : String(e)
      useAlignmentPreviewStore.getState().setRunError(msg, null)
      useAlignmentSessionStore.getState().failSession(msg)
    }
  })()

  return null
}

export function pauseAlignmentSession(): void {
  useAlignmentSessionStore.getState().setPaused()
}

export function resumeAlignmentSession(): void {
  useAlignmentSessionStore.getState().setResumed()
}
