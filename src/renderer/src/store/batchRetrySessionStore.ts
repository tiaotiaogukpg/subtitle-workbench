import { create } from 'zustand'

import { buildBatchRetryTargetIds } from '../lib/alignment/batchRetryTargets'

import {

  canStartAiOperation,

  cancelAiOperation,

  finishAiOperation,

  humanizeAiOperationError,

  isActiveRun,

  pauseAiOperation,

  patchAiOperationProgress,

  releaseAiOperationAfterStop,

  resumeAiOperation,

  startAiOperation

} from '../lib/alignment/operationGuard'

import { runBatchRetryQueue } from '../lib/alignment/runBatchRetryQueue'

import { useSubtitleStore } from './subtitleStore'



export type BatchRetrySessionStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed'



export interface BatchRetrySessionState {

  status: BatchRetrySessionStatus

  wide: boolean

  targetIds: number[]

  total: number

  completed: number

  currentSubtitleId: number | null

  lastError: string | null

  truncated: boolean

  rawTargetCount: number

  pauseRequested: boolean

  stopRequested: boolean

  operationId: number | null

}



const idleState: BatchRetrySessionState = {

  status: 'idle',

  wide: false,

  targetIds: [],

  total: 0,

  completed: 0,

  currentSubtitleId: null,

  lastError: null,

  truncated: false,

  rawTargetCount: 0,

  pauseRequested: false,

  stopRequested: false,

  operationId: null

}



interface BatchRetrySessionActions {

  requestPause: () => void

  requestResume: () => void

  requestStop: () => void

  reset: () => void

  startBatchRetry: (input: { wide: boolean; model: string; confidenceThresholdPct: number }) => Promise<void>

}



export type BatchRetrySessionStore = BatchRetrySessionState & BatchRetrySessionActions



export const useBatchRetrySessionStore = create<BatchRetrySessionStore>((set, get) => ({

  ...idleState,



  reset: () => {

    const s = get()

    if (s.status === 'running' || s.status === 'paused') return

    set({ ...idleState })

  },



  requestPause: () => {

    const s = get()

    if (s.status !== 'running') return

    if (s.operationId != null) pauseAiOperation(s.operationId)

    set({ pauseRequested: true, status: 'paused' })

  },



  requestResume: () => {

    const s = get()

    if (s.status !== 'paused') return

    if (s.operationId != null) resumeAiOperation(s.operationId)

    set({ pauseRequested: false, status: 'running' })

  },



  requestStop: () => {

    const s = get()

    if (s.status !== 'running' && s.status !== 'paused') return

    if (s.operationId != null) cancelAiOperation(s.operationId)

    set({

      stopRequested: true,

      pauseRequested: false,

      status: 'stopped',

      currentSubtitleId: null

    })

  },



  startBatchRetry: async ({ wide, model, confidenceThresholdPct }) => {

    if (get().status === 'running' || get().status === 'paused') return



    const gate = canStartAiOperation()

    if (!gate.ok) {

      set({ ...idleState, lastError: gate.reason })

      return

    }



    const subtitles = useSubtitleStore.getState().subtitles

    const { ids, truncated, rawCount } = buildBatchRetryTargetIds(subtitles, confidenceThresholdPct)



    if (ids.length === 0) {

      set({

        ...idleState,

        lastError: '当前没有符合批量重试条件的复查队列项'

      })

      return

    }



    const opType = wide ? ('batch_wide_retry' as const) : ('batch_retry' as const)

    const started = startAiOperation(opType, { totalCount: ids.length })

    if (!started.ok) {

      set({ ...idleState, lastError: started.reason })

      return

    }

    const operationId = started.operationId



    if (truncated) {

      window.alert(

        `复查队列中符合条件的有 ${rawCount} 条，超过单轮上限 ${ids.length} 条；本次仅处理前 ${ids.length} 条，请分批再跑。`

      )

    }



    set({

      status: 'running',

      wide,

      targetIds: ids,

      total: ids.length,

      completed: 0,

      currentSubtitleId: null,

      lastError: null,

      truncated,

      rawTargetCount: rawCount,

      pauseRequested: false,

      stopRequested: false,

      operationId

    })



    const attemptSource = wide ? ('batch_wide_retry' as const) : ('batch_retry' as const)



    try {

      const outcome = await runBatchRetryQueue({

        targetIds: ids,

        wide,

        attemptSource,

        model,

        confidenceThresholdPct,

        guardRunId: operationId,

        callbacks: {

          shouldContinue: () => isActiveRun(operationId) && !get().stopRequested,

          isPaused: () => get().pauseRequested,

          onLineStart: (subtitleId) => {

            if (!isActiveRun(operationId)) return

            patchAiOperationProgress({ currentItemId: subtitleId })

            set({ currentSubtitleId: subtitleId })

          },

          onLineDone: (subtitleId, completed, total) => {

            if (!isActiveRun(operationId)) return

            patchAiOperationProgress({ completedCount: completed, totalCount: total, currentItemId: subtitleId })

            set({ completed, currentSubtitleId: subtitleId })

          }

        }

      })



      if (isActiveRun(operationId)) {

        finishAiOperation(operationId)

      } else {

        releaseAiOperationAfterStop(operationId)

      }



      if (outcome === 'stopped' || get().stopRequested) {

        set({ status: 'stopped', currentSubtitleId: null, operationId: null })

      } else {

        set({ status: 'completed', currentSubtitleId: null, operationId: null })

      }

    } catch (err) {

      releaseAiOperationAfterStop(operationId)

      const msg = humanizeAiOperationError(err instanceof Error ? err.message : String(err))

      set({

        status: 'stopped',

        currentSubtitleId: null,

        operationId: null,

        lastError: msg

      })

    }

  }

}))


