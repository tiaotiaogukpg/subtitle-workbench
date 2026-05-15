import {
  advanceEnglishCursor,
  buildCandidatesForSubtitle,
  buildFullFileAlignmentReport,
  DEFAULT_GROUP_WINDOW,
  deriveStatusAfterAI,
  MAX_ENGLISH_CURSOR_ADVANCE_SEGMENTS,
  filterEnglishPoolSegments,
  pickBestStructuralAIForSubtitle,
  readableProblemsForAIRow,
  runSmallBatchAlignment,
  validateAlignmentPrerequisites,
  type AlignmentMatchValidated
} from './index'
import { pickSubtitleBatchSlice } from './batchSelection'
import { useAlignmentPreviewStore } from '../../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../../store/alignmentSessionStore'
import { useScriptPoolStore } from '../../store/scriptPoolStore'
import { useSubtitleStore } from '../../store/subtitleStore'
import type { AiAlignmentRunConfig, CandidateSegmentGroup, SubtitleStatus } from '../../types'

let runGeneration = 0

function countBatchStats(
  batchSubtitleIds: number[],
  validated: AlignmentMatchValidated[],
  thresholdPct: number,
  candidateGroups: CandidateSegmentGroup[],
  cursor: number,
  poolLength: number
): { matched: number; needsReview: number; failed: number } {
  let matched = 0
  let needsReview = 0
  let failed = 0
  for (const subtitleId of batchSubtitleIds) {
    const best = pickBestStructuralAIForSubtitle(
      validated,
      subtitleId,
      candidateGroups,
      cursor,
      poolLength,
      DEFAULT_GROUP_WINDOW
    )
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
  thresholdPct: number,
  candidateGroups: CandidateSegmentGroup[],
  englishCursor: number,
  poolLength: number
): import('./types').AlignmentMatchRow[] {
  const subtitleStore = useSubtitleStore.getState()
  const aiEntries: Array<{
    subtitleId: number
    primary: import('./types').AlignmentMatchRow
    status: SubtitleStatus
    problems: string[]
    candidates: import('../../types').CandidateMatch[]
  }> = []
  const fallbackOnly: Array<{
    subtitleId: number
    candidates?: import('../../types').CandidateMatch[]
    problems: string[]
  }> = []

  for (const subtitleId of batchSubtitleIds) {
    const rowsForSub = validated.filter((v) => v.subtitleId === subtitleId)
    const best = pickBestStructuralAIForSubtitle(
      validated,
      subtitleId,
      candidateGroups,
      englishCursor,
      poolLength,
      DEFAULT_GROUP_WINDOW
    )

    if (best) {
      const { validationFlags: _v, applyable: _a, ...row } = best
      const status = deriveStatusAfterAI(best, thresholdPct)
      let problems = readableProblemsForAIRow(best, thresholdPct)
      if (status === 'needs_review' && problems.length === 0) {
        problems = [...problems, 'This line needs manual review.']
      }
      const candidates = buildCandidatesForSubtitle(
        rowsForSub,
        best,
        candidateGroups,
        englishCursor,
        poolLength,
        DEFAULT_GROUP_WINDOW
      )
      aiEntries.push({ subtitleId, primary: row, status, problems, candidates })
    } else {
      fallbackOnly.push({
        subtitleId,
        candidates: buildCandidatesForSubtitle(
          rowsForSub,
          null,
          candidateGroups,
          englishCursor,
          poolLength,
          DEFAULT_GROUP_WINDOW
        ),
        problems: ['AI did not return a reliable match.']
      })
    }
  }

  if (aiEntries.length > 0) {
    subtitleStore.applyFullFileAIMatchBatch(aiEntries)
  }
  if (fallbackOnly.length > 0) {
    const skip = new Set(aiEntries.map((e) => e.subtitleId))
    const onlyFallback = fallbackOnly.filter((f) => !skip.has(f.subtitleId))
    if (onlyFallback.length > 0) {
      subtitleStore.applyAlignmentReviewStates(onlyFallback)
    }
  }

  return aiEntries.map((e) => e.primary)
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
  const stats = countBatchStats(
    result.batchSubtitleIds,
    result.validated,
    config.confidenceThreshold,
    result.candidateGroups,
    result.debug.englishCursor,
    result.debug.englishPoolSize
  )

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
  const usedSegmentIdsGlobal = new Set<string>()

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
      confidenceThresholdPct: config.confidenceThreshold,
      usedSegmentIdsGlobal
    })

    if (generation !== runGeneration) return

    if (!result.ok) {
      useAlignmentPreviewStore.getState().setRunError(result.error, result.debug)
      session.failSession(result.error)
      return
    }

    const poolLen = filterEnglishPoolSegments(segments).length

    if (result.report.alignmentDrift) {
      useAlignmentPreviewStore.getState().setSuccess({
        validated: result.validated,
        applyable: result.applyable,
        candidateGroups: result.candidateGroups,
        batchSubtitleIds: result.batchSubtitleIds,
        segmentIdsInContext: [...new Set(result.candidateGroups.flatMap((g) => g.segmentIds))],
        report: result.report,
        debug: result.debug
      })
      session.failSession(
        '整文件对齐已暂停：本批检测到 alignment drift。请检查 English cursor、字幕与英文池对应关系后重试。'
      )
      return
    }

    const applied = applyFullFileBatchResults(
      result.batchSubtitleIds,
      result.validated,
      config.confidenceThreshold,
      result.candidateGroups,
      result.debug.englishCursor,
      poolLen
    )
    trackSegmentUsage(segmentUsage, applied)

    const ids = new Set<string>()
    for (const m of applied) {
      for (const id of m.matchedSegmentIds) {
        ids.add(id)
        usedSegmentIdsGlobal.add(id)
      }
    }
    useScriptPoolStore.getState().markSegmentsUsedForAlignment([...ids])

    const maxAdvance = Math.min(
      MAX_ENGLISH_CURSOR_ADVANCE_SEGMENTS,
      Math.max(6, batch.length * 2 + 4)
    )
    englishCursor = advanceEnglishCursor({
      previousCursor: englishCursor,
      acceptedMatches: applied,
      candidateGroups: result.candidateGroups,
      poolLength: poolLen,
      maxAdvanceSegments: maxAdvance
    })
    useAlignmentPreviewStore.getState().setEnglishCursor(englishCursor)

    const stats = countBatchStats(
      result.batchSubtitleIds,
      result.validated,
      config.confidenceThreshold,
      result.candidateGroups,
      result.debug.englishCursor,
      poolLen
    )

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
