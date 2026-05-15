import { create } from 'zustand'
import type { DeepSeekAlignmentMatchValidated } from '../lib/realAlignmentBatch'

export type AlignmentPreviewDebug = {
  promptTokenEstimate: number
  rawResponse: string
  parseError: string | null
  parsedJson: string | null
  latencyMs: number
  usagePromptTokens: number | null
  /** Script Pool 总条数（含空文本）。 */
  poolSegmentTotal: number | null
  /** 通过「英文 + 纯英文文本」过滤后的可候选总数（整池，非仅本窗口）。 */
  pureEnglishPoolTotal: number | null
  /** 本请求实际发给模型的英文候选条数（窗口切片）。 */
  deepSeekCandidateSent: number | null
  /** 有文本但未进入 DeepSeek 候选池的条数（含中文/混写/非 english 等）。 */
  excludedFromDeepSeekCount: number | null
  validationWarnings: string[]
}

interface AlignmentPreviewState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  runError: string | null
  previewMatches: DeepSeekAlignmentMatchValidated[] | null
  batchSubtitleIds: number[]
  segmentIdsInContext: string[]
  debug: AlignmentPreviewDebug | null
}

interface AlignmentPreviewActions {
  reset: () => void
  startLoading: (batchSubtitleIds: number[], segmentIdsInContext: string[]) => void
  setSuccess: (payload: {
    matches: DeepSeekAlignmentMatchValidated[]
    batchSubtitleIds: number[]
    segmentIdsInContext: string[]
    debug: AlignmentPreviewDebug
  }) => void
  setRunError: (message: string, debug: AlignmentPreviewDebug | null) => void
}

const initial: AlignmentPreviewState = {
  phase: 'idle',
  runError: null,
  previewMatches: null,
  batchSubtitleIds: [],
  segmentIdsInContext: [],
  debug: null
}

export const useAlignmentPreviewStore = create<AlignmentPreviewState & AlignmentPreviewActions>((set) => ({
  ...initial,

  reset: () => set({ ...initial }),

  startLoading: (batchSubtitleIds, segmentIdsInContext) =>
    set({
      phase: 'loading',
      runError: null,
      previewMatches: null,
      batchSubtitleIds,
      segmentIdsInContext,
      debug: null
    }),

  setSuccess: ({ matches, batchSubtitleIds, segmentIdsInContext, debug }) =>
    set({
      phase: 'ready',
      runError: null,
      previewMatches: matches,
      batchSubtitleIds,
      segmentIdsInContext,
      debug
    }),

  setRunError: (message, debug) =>
    set((s) => ({
      phase: 'error',
      runError: message,
      previewMatches: null,
      debug: debug ?? s.debug,
      batchSubtitleIds: s.batchSubtitleIds,
      segmentIdsInContext: s.segmentIdsInContext
    }))
}))
