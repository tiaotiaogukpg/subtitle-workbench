import {
  advanceEnglishCursor,
  buildFullFileAlignmentReport,
  confidenceToPercent,
  filterEnglishPoolSegments,
  runSmallBatchAlignment,
  validateAlignmentPrerequisites,
  type AlignmentMatchValidated
} from './index'
import { pickSubtitleBatchSlice } from './batchSelection'
import { useAlignmentPreviewStore } from '../../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../../store/alignmentSessionStore'
import { useScriptPoolStore } from '../../store/scriptPoolStore'
import { useSubtitleStore } from '../../store/subtitleStore'
import type { AiAlignmentRunConfig } from '../../types'

let runGeneration = 0

function countBatchStats(
  validated: AlignmentMatchValidated[],
  thresholdPct: number
): { matched: number; needsReview: number; failed: number } {
  let matched = 0
  let needsReview = 0
  let failed = 0
  for (const v of validated) {
    if (!v.applyable) {
      failed++
      continue
    }
    matched++
    if (confidenceToPercent(v.confidence) < thresholdPct) needsReview++
  }
  return { matched, needsReview, failed }
}

function applyFullFileBatchResults(
  batchSubtitleIds: number[],
  validated: AlignmentMatchValidated[],
  applyable: import('./types').AlignmentMatchRow[],
  thresholdPct: number
): void {
  const subtitleStore = useSubtitleStore.getState()
  if (applyable.length > 0) {
    subtitleStore.applyDeepSeekPreviewMatches(applyable)
  }
  const matchedIds = new Set(applyable.map((m) => m.subtitleId))

  for (const v of validated) {
    if (v.applyable) {
      if (confidenceToPercent(v.confidence) < thresholdPct) {
        subtitleStore.addProblem(v.subtitleId, 'ai_alignment:low_confidence')
      }
      continue
    }
    subtitleStore.addProblem(v.subtitleId, 'ai_alignment:needs_review')
    subtitleStore.updateStatus(v.subtitleId, 'unmatched')
  }

  for (const id of batchSubtitleIds) {
    if (!matchedIds.has(id)) {
      subtitleStore.updateStatus(id, 'unmatched')
      subtitleStore.addProblem(id, 'ai_alignment:unmatched')
    }
  }
}

function trackSegmentUsage(
  usage: Map<string, number>,
  applyable: import('./types').AlignmentMatchRow[]
): void {
  for (const m of applyable) {
    for (const id of m.matchedSegmentIds) {
      usage.set(id, (usage.get(id) ?? 0) + 1)
    }
  }
}

function duplicateSegmentIdsFromUsage(usage: Map<string, number>): string[] {
  return [...usage.entries()].filter(([, count]) => count > 1).map(([id]) => id)
}

async function runSingleBatchTest(
  config: AiAlignmentRunConfig,
  generation: number
): Promise<void> {
  const session = useAlignmentSessionStore.getState()
  const subtitles = useSubtitleStore.getState().subtitles
  const currentSubtitleId = useSubtitleStore.getState().currentSubtitleId
  const segments = useScriptPoolStore.getState().segments
  const preview = useAlignmentPreviewStore.getState()
  const englishCursor = preview.englishCursor

  session.noteBatchProgress({
    batchIndex: 0,
    totalBatches: 1,
    batchLabel: '请求中…',
    processingSubtitleId: currentSubtitleId,
    processedSubtitleCount: 0,
    englishCursor,
    matchedDelta: 0,
    needsReviewDelta: 0,
    failedDelta: 0
  })

  if (generation !== runGeneration) return

  const result = await runSmallBatchAlignment({
    subtitles,
    currentSubtitleId,
    segments,
    englishCursor,
    model: config.model,
    batchSize: config.batchSize,
    confidenceThresholdPct: config.confidenceThreshold
  })

  if (generation !== runGeneration) return

  if (!result.ok) {
    useAlignmentPreviewStore.getState().setRunError(result.error, result.debug)
    useAlignmentSessionStore.getState().failSession(result.error)
    return
  }

  const batchLabel =
    result.batch.length > 0
      ? `#${result.batch[0]!.id}–#${result.batch[result.batch.length - 1]!.id}`
      : '—'
  const stats = countBatchStats(result.validated, config.confidenceThreshold)

  useAlignmentPreviewStore.getState().setSuccess({
    validated: result.validated,
    applyable: result.applyable,
    candidateGroups: result.candidateGroups,
    batchSubtitleIds: result.batchSubtitleIds,
    segmentIdsInContext: [...new Set(result.candidateGroups.flatMap((g) => g.segmentIds))],
    report: result.report,
    debug: result.debug
  })

  useAlignmentSessionStore.getState().noteBatchProgress({
    batchIndex: 1,
    totalBatches: 1,
    batchLabel,
    processingSubtitleId: null,
    processedSubtitleCount: result.batch.length,
    englishCursor: result.debug.englishCursor,
    matchedDelta: stats.matched,
    needsReviewDelta: stats.needsReview,
    failedDelta: stats.failed
  })

  useAlignmentSessionStore.getState().completeSession(
    `调试小批完成 · 可应用 ${result.applyable.length}/${result.batch.length} · 请在 Debug 区手动应用`
  )
}

async function runFullFileAlignment(
  config: AiAlignmentRunConfig,
  generation: number
): Promise<void> {
  const session = useAlignmentSessionStore.getState()
  const subtitles = useSubtitleStore.getState().subtitles
  const segments = useScriptPoolStore.getState().segments
  let englishCursor = useAlignmentPreviewStore.getState().englishCursor
  const batchSize = config.batchSize
  const totalBatches = Math.max(1, Math.ceil(subtitles.length / batchSize))

  let subtitleStart = 0
  let batchIndex = 0
  const segmentUsage = new Map<string, number>()

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
      englishCursor,
      matchedDelta: 0,
      needsReviewDelta: 0,
      failedDelta: 0
    })

    const result = await runSmallBatchAlignment({
      subtitles,
      currentSubtitleId: batch[0]!.id,
      segments,
      englishCursor,
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

    applyFullFileBatchResults(
      result.batchSubtitleIds,
      result.validated,
      result.applyable,
      config.confidenceThreshold
    )
    trackSegmentUsage(segmentUsage, result.applyable)

    const ids = new Set<string>()
    for (const m of result.applyable) {
      for (const id of m.matchedSegmentIds) ids.add(id)
    }
    useScriptPoolStore.getState().markSegmentsUsedForAlignment([...ids])

    englishCursor = advanceEnglishCursor({
      previousCursor: englishCursor,
      acceptedMatches: result.applyable,
      candidateGroups: result.candidateGroups,
      poolLength: filterEnglishPoolSegments(segments).length
    })
    useAlignmentPreviewStore.getState().setEnglishCursor(englishCursor)

    const stats = countBatchStats(result.validated, config.confidenceThreshold)

    useAlignmentPreviewStore.getState().setSuccess({
      validated: result.validated,
      applyable: result.applyable,
      candidateGroups: result.candidateGroups,
      batchSubtitleIds: result.batchSubtitleIds,
      segmentIdsInContext: [...new Set(result.candidateGroups.flatMap((g) => g.segmentIds))],
      report: result.report,
      debug: result.debug
    })

    session.noteBatchProgress({
      batchIndex,
      totalBatches,
      batchLabel,
      processingSubtitleId: null,
      processedSubtitleCount: subtitleStart + batch.length,
      englishCursor,
      matchedDelta: stats.matched,
      needsReviewDelta: stats.needsReview,
      failedDelta: stats.failed
    })

    subtitleStart += batch.length
  }

  if (generation !== runGeneration) return

  const duplicateIds = duplicateSegmentIdsFromUsage(segmentUsage)
  const finalReport = buildFullFileAlignmentReport({
    subtitles: useSubtitleStore.getState().subtitles,
    segments: useScriptPoolStore.getState().segments,
    duplicateSegmentIds: duplicateIds
  })

  const s = useAlignmentSessionStore.getState()
  s.completeSession(
    `整文件完成 · 已匹配 ${finalReport.matchedSubtitleCount}/${finalReport.totalSubtitleCount} · 需复查 ${finalReport.needsReviewCount} · 未匹配 ${finalReport.unmatchedCount}`,
    finalReport
  )
}

/** 后台启动对齐：调用方应在之后立即关闭 Modal。 */
export function startAlignmentSession(config: AiAlignmentRunConfig, apiKey: string): string | null {
  const blocked = validateAlignmentPrerequisites({
    apiKey,
    subtitleCount: useSubtitleStore.getState().subtitles.length,
    englishPoolSize: filterEnglishPoolSegments(useScriptPoolStore.getState().segments).length,
    bridgeReady: Boolean(window.bilingualSubtitleAligner?.alignDeepSeekBatch)
  })
  if (blocked) return blocked

  const status = useAlignmentSessionStore.getState().status
  if (status === 'running') return '已有对齐任务正在运行。'

  const subtitles = useSubtitleStore.getState().subtitles
  const totalBatches =
    config.mode === 'full_file'
      ? Math.max(1, Math.ceil(subtitles.length / config.batchSize))
      : 1

  runGeneration += 1
  const generation = runGeneration

  useAlignmentSessionStore.getState().beginSession(config, subtitles.length, totalBatches)
  useAlignmentPreviewStore.getState().startLoading()
  useAlignmentSessionStore.getState().patchProgress({
    englishCursor: useAlignmentPreviewStore.getState().englishCursor
  })

  void (async () => {
    try {
      if (config.mode === 'full_file') {
        await runFullFileAlignment(config, generation)
      } else {
        await runSingleBatchTest(config, generation)
      }
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
