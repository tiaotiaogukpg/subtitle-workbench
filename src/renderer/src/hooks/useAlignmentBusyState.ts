import { isAnyAiOperationActive } from '../lib/alignment/operationGuard'
import { isAlignmentSessionActive, useAlignmentSessionStore } from '../store/alignmentSessionStore'
import { useBatchRetrySessionStore } from '../store/batchRetrySessionStore'

export interface AlignmentBusyState {
  alignmentSessionBusy: boolean
  alignmentSessionStatus: string
  lineRetryBusy: 'idle' | 'narrow' | 'wide'
  batchStatus: string
  batchRunActive: boolean
  batchCompleted: number
  batchTotal: number
  anyTaskBusy: boolean
  retryDisabled: boolean
  batchRetryDisabled: boolean
  /** 顶栏任务状态条主文案；无任务时为 null */
  taskStatusLabel: string | null
  taskStatusDetail: string | null
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  idle: '',
  running: '整文件 AI 对齐进行中',
  paused: '整文件 AI 对齐已暂停',
  completed: '',
  failed: '整文件对齐失败',
  stopped: '整文件对齐已停止'
}

const BATCH_STATUS_LABEL: Record<string, string> = {
  idle: '',
  running: '批量重试进行中',
  paused: '批量重试已暂停',
  stopped: '批量重试已停止',
  completed: '批量重试已完成'
}

export function useAlignmentBusyState(lineRetryBusy: 'idle' | 'narrow' | 'wide' = 'idle'): AlignmentBusyState {
  const alignmentSessionStatus = useAlignmentSessionStore((s) => s.status)
  const alignmentSessionBusy = isAlignmentSessionActive(alignmentSessionStatus)
  const batchStatus = useBatchRetrySessionStore((s) => s.status)
  const batchRunActive = batchStatus === 'running' || batchStatus === 'paused'
  const batchCompleted = useBatchRetrySessionStore((s) => s.completed)
  const batchTotal = useBatchRetrySessionStore((s) => s.total)
  const batchCurrentId = useBatchRetrySessionStore((s) => s.currentSubtitleId)
  const batchWide = useBatchRetrySessionStore((s) => s.wide)

  const anyTaskBusy = isAnyAiOperationActive() || lineRetryBusy !== 'idle'
  const retryDisabled = anyTaskBusy
  const batchRetryDisabled = anyTaskBusy

  let taskStatusLabel: string | null = null
  let taskStatusDetail: string | null = null

  if (alignmentSessionBusy) {
    taskStatusLabel = SESSION_STATUS_LABEL[alignmentSessionStatus] || '整文件 AI 对齐进行中'
    taskStatusDetail = alignmentSessionStatus === 'paused' ? '点击右侧「继续」恢复' : '其它重试操作暂不可用'
  } else if (batchRunActive) {
    taskStatusLabel = BATCH_STATUS_LABEL[batchStatus] || '批量重试进行中'
    const mode = batchWide ? '扩窗批量' : '标准批量'
    taskStatusDetail =
      batchTotal > 0
        ? `${mode} · ${batchCompleted}/${batchTotal}${
            batchCurrentId != null ? ` · 当前 #${String(batchCurrentId).padStart(3, '0')}` : ''
          }`
        : mode
  } else if (lineRetryBusy === 'narrow') {
    taskStatusLabel = '正在重试本行…'
    taskStatusDetail = '仅追加 AI 尝试，不会自动改写当前英文'
  } else if (lineRetryBusy === 'wide') {
    taskStatusLabel = '正在扩窗重试本行…'
    taskStatusDetail = '使用更大英文上下文，仅追加尝试'
  }

  return {
    alignmentSessionBusy,
    alignmentSessionStatus,
    lineRetryBusy,
    batchStatus,
    batchRunActive,
    batchCompleted,
    batchTotal,
    anyTaskBusy,
    retryDisabled,
    batchRetryDisabled,
    taskStatusLabel,
    taskStatusDetail
  }
}
