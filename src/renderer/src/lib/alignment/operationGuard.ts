/**
 * 全局 AI 长任务互斥与 runId 守卫（防止过期异步写入）。
 * 不替代各 session store 的 UI 状态，但所有 AI 任务启动/结束应经过此处。
 */

export type OperationStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'completed'
  | 'failed'

export type AiOperationType =
  | 'full_file_alignment'
  | 'single_line_retry'
  | 'single_line_wide_retry'
  | 'batch_retry'
  | 'batch_wide_retry'

export interface ActiveAiOperation {
  operationId: number
  operationType: AiOperationType
  status: OperationStatus
  startedAt: number
  currentItemId: number | null
  completedCount: number
  totalCount: number
  errorMessage: string | null
  cancelled: boolean
}

export type StartAiOperationResult =
  | { ok: true; operationId: number }
  | { ok: false; reason: string }

let nextOperationId = 0
let active: ActiveAiOperation | null = null

function touchActive(patch: Partial<ActiveAiOperation>): void {
  if (!active) return
  active = { ...active, ...patch }
}

export function getActiveAiOperation(): ActiveAiOperation | null {
  return active
}

export function isAnyAiOperationActive(): boolean {
  if (!active) return false
  return active.status === 'running' || active.status === 'paused' || active.status === 'stopping'
}

/** @deprecated 与 isAnyAiOperationActive 同义，供导入守卫等使用 */
export function isAiTaskRunning(): boolean {
  return isAnyAiOperationActive()
}

export function canStartAiOperation(): { ok: true } | { ok: false; reason: string } {
  if (!active) return { ok: true }
  if (active.status === 'stopping') {
    return { ok: false, reason: '上一任务正在停止，请稍候再试。' }
  }
  if (active.status === 'running' || active.status === 'paused') {
    return { ok: false, reason: '已有 AI 任务进行中，请先等待结束或停止当前任务。' }
  }
  return { ok: true }
}

export function startAiOperation(
  operationType: AiOperationType,
  meta?: { totalCount?: number }
): StartAiOperationResult {
  const gate = canStartAiOperation()
  if (!gate.ok) return gate

  nextOperationId += 1
  active = {
    operationId: nextOperationId,
    operationType,
    status: 'running',
    startedAt: Date.now(),
    currentItemId: null,
    completedCount: 0,
    totalCount: meta?.totalCount ?? 0,
    errorMessage: null,
    cancelled: false
  }
  return { ok: true, operationId: nextOperationId }
}

export function isActiveRun(operationId: number): boolean {
  return active !== null && active.operationId === operationId && !active.cancelled
}

export function patchAiOperationProgress(patch: {
  currentItemId?: number | null
  completedCount?: number
  totalCount?: number
}): void {
  if (!active) return
  touchActive(patch)
}

export function pauseAiOperation(operationId?: number): void {
  if (!active) return
  if (operationId != null && active.operationId !== operationId) return
  if (active.status === 'running') touchActive({ status: 'paused' })
}

export function resumeAiOperation(operationId?: number): void {
  if (!active) return
  if (operationId != null && active.operationId !== operationId) return
  if (active.status === 'paused') touchActive({ status: 'running' })
}

export function cancelAiOperation(operationId?: number): void {
  if (!active) return
  if (operationId != null && active.operationId !== operationId) return
  touchActive({ cancelled: true, status: 'stopping' })
}

export function finishAiOperation(operationId: number): void {
  if (!active || active.operationId !== operationId) return
  active = null
}

export function failAiOperation(operationId: number, error: string): void {
  if (!active || active.operationId !== operationId) return
  const msg = humanizeAiOperationError(error)
  touchActive({ status: 'failed', errorMessage: msg, cancelled: false })
  active = null
}

export function releaseAiOperationAfterStop(operationId: number): void {
  if (!active || active.operationId !== operationId) return
  active = null
}

export function canImportProjectData(): { ok: true } | { ok: false; reason: string } {
  if (isAnyAiOperationActive()) {
    return { ok: false, reason: 'AI 任务进行中，请等待结束或停止后再导入，以免覆盖正在写入的数据。' }
  }
  return { ok: true }
}

export function canExportProjectData(): { ok: true } | { ok: false; reason: string } {
  if (isAnyAiOperationActive()) {
    return {
      ok: false,
      reason: 'AI 任务仍在写入字幕数据，建议等待任务结束后再导出，以免文件不完整。'
    }
  }
  return { ok: true }
}

export function humanizeAiOperationError(raw: string): string {
  const t = raw.trim()
  if (!t) return '对齐任务异常结束，可稍后重试。'

  const lower = t.toLowerCase()
  if (/parse|json|invalid item|unexpected token/i.test(t)) {
    return '模型返回格式异常，本次结果未完全应用，可重试。'
  }
  if (/promise rejected|network|fetch|econnreset|timeout|timed out/i.test(lower)) {
    return '网络或请求超时，请检查连接后重试。'
  }
  if (/api key|unauthorized|401|403/i.test(lower)) {
    return 'API 密钥无效或未授权，请在设置中检查密钥。'
  }
  if (/abort/i.test(lower)) {
    return '任务已取消。'
  }
  if (/已有对齐|已有 ai|进行中/i.test(t)) {
    return t
  }
  return '对齐任务失败，请查看详情后重试。'
}

/** 测试用：重置全局状态 */
export function _resetOperationGuardForTests(): void {
  nextOperationId = 0
  active = null
}
