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
import { runSmallBatchAlignment } from './smallBatchPipeline'
import type { AlignmentMatchValidated } from './types'
import { useAlignmentPreviewStore } from '../../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../../store/alignmentSessionStore'
import { useScriptPoolStore } from '../../store/scriptPoolStore'
import { useSubtitleStore } from '../../store/subtitleStore'
import type { AiAlignmentRunConfig, SubtitleStatus } from '../../types'

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
    const best = pickBestStructuralAIForSubtitle(validated, subtitleId)
    if (!best) {
      failed++
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
  thresholdPct: number
): import('./types').AlignmentMatchRow[] {
  const subtitleStore = useSubtitleStore.getState()
  const aiEntries: Array<{
    subtitleId: number
    primary: import('./types').AlignmentMatchRow
    status: SubtitleStatus
    problems: string[]
    candidates: import('../../types').CandidateMatch[]
  }> = []
  const linesWithoutAiWrite: Array<{
    subtitleId: number
    candidates?: import('../../types').CandidateMatch[]
    problems: string[]
  }> = []

  for (const subtitleId of batchSubtitleIds) {
    const rowsForSub = validated.filter((v) => v.subtitleId === subtitleId)
    const best = pickBestStructuralAIForSubtitle(validated, subtitleId)

    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      const status = deriveStatusAfterAI(best, thresholdPct)
      const problems = readableProblemsForAIRow(best, thresholdPct)
      const candidates = buildCandidatesForSubtitle(rowsForSub, best)
      aiEntries.push({ subtitleId, primary: row, status, problems, candidates })
    } else {
      linesWithoutAiWrite.push({
        subtitleId,
        candidates: buildCandidatesForSubtitle(rowsForSub, null),
        problems: diagnosticProblemsForFailedAlignment(rowsForSub)
      })
    }
  }

  if (aiEntries.length > 0) {
    subtitleStore.applyFullFileAIMatchBatch(aiEntries)
  }
  if (linesWithoutAiWrite.length > 0) {
    const skip = new Set(aiEntries.map((e) => e.subtitleId))
    const onlyReview = linesWithoutAiWrite.filter((f) => !skip.has(f.subtitleId))
    if (onlyReview.length > 0) {
      subtitleStore.applyAlignmentReviewStates(onlyReview)
    }
  }

  return aiEntries.map((e) => e.primary)
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

    applyFullFileBatchResults(result.batchSubtitleIds, result.validated, config.confidenceThreshold)

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

  const finalReport = buildFullFileAlignmentReport({
    subtitles: useSubtitleStore.getState().subtitles,
    segments: useScriptPoolStore.getState().segments,
    duplicateSegmentIds: []
  })

  const s = useAlignmentSessionStore.getState()
  s.completeSession(
    `整文件完成 · 已匹配 ${finalReport.matchedSubtitleCount}/${finalReport.totalSubtitleCount} · 需复查 ${finalReport.needsReviewCount} · 未匹配 ${finalReport.unmatchedCount}`,
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
