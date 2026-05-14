import { create } from 'zustand'
import type { DeepSeekAlignmentMatchRow } from '../lib/realAlignmentBatch'

export type AlignmentPreviewDebug = {
  promptTokenEstimate: number
  rawResponse: string
  parseError: string | null
  parsedJson: string | null
  latencyMs: number
  usagePromptTokens: number | null
}

interface AlignmentPreviewState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  runError: string | null
  previewMatches: DeepSeekAlignmentMatchRow[] | null
  batchSubtitleIds: number[]
  segmentIdsInContext: string[]
  debug: AlignmentPreviewDebug | null
}

interface AlignmentPreviewActions {
  reset: () => void
  startLoading: (batchSubtitleIds: number[], segmentIdsInContext: string[]) => void
  setSuccess: (payload: {
    matches: DeepSeekAlignmentMatchRow[]
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
