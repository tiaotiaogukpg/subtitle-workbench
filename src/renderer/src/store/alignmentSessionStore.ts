import { create } from 'zustand'
import type { FullFileAlignmentReport } from '../lib/alignment/completeness'
import type { AiAlignmentRunConfig } from '../types'

/** 整文件对齐因 drift 暂停时保存的续跑上下文（不写入本批字幕）。 */
export interface FullFileDriftContinuation {
  /** 当前失败/待处理批在 subtitles 数组中的起始下标 */
  subtitleStart: number
  /** 本批字幕条数（与上次 runSmallBatchAlignment 一致） */
  failedBatchSize: number
  /** 与 noteBatchProgress 一致：本批失败时已递增到的 batch 序号（1-based） */
  lastBatchIndexUsed: number
  totalBatches: number
  segmentUsage: Record<string, number>
  usedSegmentIdsGlobal: string[]
  batchSubtitleIds: number[]
  batchLabel: string
}

export type AlignmentSessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'drift_recovery'

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
  englishCursor: number
  lastError: string | null
  lastSummary: string
  activeConfig: AiAlignmentRunConfig | null
  finalReport: FullFileAlignmentReport | null
  /** 仅 `drift_recovery`：续跑所需状态 */
  driftContinuation: FullFileDriftContinuation | null
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
    englishCursor: number
    matchedDelta: number
    needsReviewDelta: number
    failedDelta: number
  }) => void
  completeSession: (summary: string, finalReport?: FullFileAlignmentReport | null) => void
  failSession: (error: string) => void
  resetSession: () => void
  enterDriftRecovery: (continuation: FullFileDriftContinuation, summary: string) => void
  clearDriftContinuation: () => void
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
  englishCursor: 0,
  lastError: null,
  lastSummary: '尚未运行',
  activeConfig: null,
  finalReport: null,
  driftContinuation: null
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
        lastError: null,
        englishCursor: 0,
        driftContinuation: null
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
      englishCursor,
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
          englishCursor,
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
        finalReport: finalReport ?? s.finalReport,
        driftContinuation: null
      })),

    failSession: (error) =>
      set((s) => ({
        status: 'failed',
        processingSubtitleId: null,
        lastError: error,
        lastSummary: `失败：${error}`,
        driftContinuation: null
      })),

    resetSession: () => set({ ...idleSnapshot }),

    enterDriftRecovery: (continuation, summary) =>
      set({
        status: 'drift_recovery',
        processingSubtitleId: null,
        lastError: null,
        lastSummary: summary,
        driftContinuation: continuation
      }),

    clearDriftContinuation: () => set({ driftContinuation: null }),

    stopSessionAsUserCancelled: (summary) =>
      set({
        status: 'stopped',
        processingSubtitleId: null,
        lastError: null,
        lastSummary: summary ?? '整文件对齐已由用户停止；已保留此前已写入的结果。',
        driftContinuation: null
      })
  })
)

export function isAlignmentSessionActive(status: AlignmentSessionStatus): boolean {
  return status === 'running' || status === 'paused'
}
