import { create } from 'zustand'
import type { FullFileAlignmentReport } from '../lib/alignment/completeness'
import type { AiAlignmentRunConfig } from '../types'

export type AlignmentSessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'

export interface AlignmentSessionSnapshot {
  status: AlignmentSessionStatus
  progressPct: number
  currentBatchIndex: number
  totalBatches: number
  currentBatchLabel: string
  processingSubtitleId: number | null
  processedSubtitleCount: number
  totalSubtitleCount: number
  sessionMatchedCount: number
  sessionNeedsReviewCount: number
  sessionFailedCount: number
  lastError: string | null
  lastSummary: string
  activeConfig: AiAlignmentRunConfig | null
  finalReport: FullFileAlignmentReport | null
  /** 首轮完成后 Retry Coverage Pass。 */
  coverageRetryPhase: 'idle' | 'running' | 'completed'
  /** 进入 Retry 前：已有英文且为 confirmed / low_confidence 的行数。 */
  firstPassMatchedCount: number
  /** Retry 各批累计写入的可结构对齐行数。 */
  retryMatchedDeltaCount: number
  /** Retry 全部结束后仍符合 retry 目标的行数。 */
  retryStillNeedsReviewCount: number
}

interface AlignmentSessionActions {
  beginSession: (config: AiAlignmentRunConfig, totalSubtitles: number, totalBatches: number) => void
  setPaused: () => void
  setResumed: () => void
  patchProgress: (patch: Partial<AlignmentSessionSnapshot>) => void
  noteBatchProgress: (input: {
    batchIndex: number
    totalBatches: number
    batchLabel: string
    processingSubtitleId: number | null
    processedSubtitleCount: number
    matchedDelta: number
    needsReviewDelta: number
    failedDelta: number
  }) => void
  completeSession: (summary: string, finalReport?: FullFileAlignmentReport | null) => void
  failSession: (error: string) => void
  resetSession: () => void
  stopSessionAsUserCancelled: (summary?: string) => void
}

const idleSnapshot: AlignmentSessionSnapshot = {
  status: 'idle',
  progressPct: 0,
  currentBatchIndex: 0,
  totalBatches: 0,
  currentBatchLabel: '—',
  processingSubtitleId: null,
  processedSubtitleCount: 0,
  totalSubtitleCount: 0,
  sessionMatchedCount: 0,
  sessionNeedsReviewCount: 0,
  sessionFailedCount: 0,
  lastError: null,
  lastSummary: '尚未运行',
  activeConfig: null,
  finalReport: null,
  coverageRetryPhase: 'idle',
  firstPassMatchedCount: 0,
  retryMatchedDeltaCount: 0,
  retryStillNeedsReviewCount: 0
}

export const useAlignmentSessionStore = create<AlignmentSessionSnapshot & AlignmentSessionActions>(
  (set, get) => ({
    ...idleSnapshot,

    beginSession: (config, totalSubtitles, totalBatches) =>
      set({
        ...idleSnapshot,
        status: 'running',
        activeConfig: config,
        totalSubtitleCount: totalSubtitles,
        totalBatches,
        currentBatchIndex: 0,
        currentBatchLabel: '准备中…',
        lastSummary: '对齐任务已启动',
        lastError: null
      }),

    setPaused: () => {
      const s = get()
      if (s.status === 'running') set({ status: 'paused' })
    },

    setResumed: () => {
      const s = get()
      if (s.status === 'paused') set({ status: 'running' })
    },

    patchProgress: (patch) => set((s) => ({ ...s, ...patch })),

    noteBatchProgress: ({
      batchIndex,
      totalBatches,
      batchLabel,
      processingSubtitleId,
      processedSubtitleCount,
      matchedDelta,
      needsReviewDelta,
      failedDelta
    }) =>
      set((s) => {
        const progressPct =
          totalBatches > 0 ? Math.min(100, Math.round((batchIndex / totalBatches) * 100)) : 0
        return {
          currentBatchIndex: batchIndex,
          totalBatches,
          currentBatchLabel: batchLabel,
          processingSubtitleId,
          processedSubtitleCount,
          progressPct,
          sessionMatchedCount: s.sessionMatchedCount + matchedDelta,
          sessionNeedsReviewCount: s.sessionNeedsReviewCount + needsReviewDelta,
          sessionFailedCount: s.sessionFailedCount + failedDelta
        }
      }),

    completeSession: (summary, finalReport = null) =>
      set((s) => ({
        status: 'completed',
        progressPct: 100,
        processingSubtitleId: null,
        lastSummary: summary,
        lastError: null,
        finalReport: finalReport ?? s.finalReport
      })),

    failSession: (error) =>
      set({
        status: 'failed',
        processingSubtitleId: null,
        lastError: error,
        lastSummary: `失败：${error}`
      }),

    resetSession: () => set({ ...idleSnapshot }),

    stopSessionAsUserCancelled: (summary) =>
      set({
        status: 'stopped',
        processingSubtitleId: null,
        lastError: null,
        lastSummary: summary ?? '整文件对齐已由用户停止；已保留此前已写入的结果。'
      })
  })
)

export function isAlignmentSessionActive(status: AlignmentSessionStatus): boolean {
  return status === 'running' || status === 'paused'
}
