import { create } from 'zustand'
import type { CandidateSegmentGroup } from '../types'
import type { AlignmentMatchRow, AlignmentMatchValidated } from '../lib/alignment/types'
import type { AlignmentReport } from '../lib/alignment/completeness'
import type { SmallBatchAlignmentDebug } from '../lib/alignment/smallBatchPipeline'

export type AlignmentPreviewDebug = SmallBatchAlignmentDebug

interface AlignmentPreviewState {
  phase: 'idle' | 'loading' | 'ready' | 'error'
  runError: string | null
  previewMatches: AlignmentMatchValidated[] | null
  applyableMatches: AlignmentMatchRow[] | null
  lastCandidateGroups: CandidateSegmentGroup[]
  lastReport: AlignmentReport | null
  batchSubtitleIds: number[]
  debug: AlignmentPreviewDebug | null
}

interface AlignmentPreviewActions {
  reset: () => void
  startLoading: () => void
  setSuccess: (payload: {
    validated: AlignmentMatchValidated[]
    applyable: AlignmentMatchRow[]
    candidateGroups: CandidateSegmentGroup[]
    batchSubtitleIds: number[]
    report: AlignmentReport
    debug: AlignmentPreviewDebug
  }) => void
  setRunError: (message: string, debug: AlignmentPreviewDebug | null) => void
}

const initial: AlignmentPreviewState = {
  phase: 'idle',
  runError: null,
  previewMatches: null,
  applyableMatches: null,
  lastCandidateGroups: [],
  lastReport: null,
  batchSubtitleIds: [],
  debug: null
}

export const useAlignmentPreviewStore = create<AlignmentPreviewState & AlignmentPreviewActions>((set) => ({
  ...initial,

  reset: () => set({ ...initial }),

  startLoading: () =>
    set({
      phase: 'loading',
      runError: null,
      previewMatches: null,
      applyableMatches: null,
      lastCandidateGroups: [],
      lastReport: null,
      batchSubtitleIds: [],
      debug: null
    }),

  setSuccess: ({ validated, applyable, candidateGroups, batchSubtitleIds, report, debug }) =>
    set({
      phase: 'ready',
      runError: null,
      previewMatches: validated,
      applyableMatches: applyable,
      lastCandidateGroups: candidateGroups,
      lastReport: report,
      batchSubtitleIds,
      debug
    }),

  setRunError: (message, debug) =>
    set((s) => ({
      phase: 'error',
      runError: message,
      previewMatches: null,
      applyableMatches: null,
      debug: debug ?? s.debug,
      batchSubtitleIds: s.batchSubtitleIds
    }))
}))
