import { describe, expect, it } from 'vitest'
import {
  _resetOperationGuardForTests,
  canStartAiOperation,
  cancelAiOperation,
  failAiOperation,
  finishAiOperation,
  isActiveRun,
  isAnyAiOperationActive,
  pauseAiOperation,
  releaseAiOperationAfterStop,
  resumeAiOperation,
  startAiOperation
} from './operationGuard'

describe('operationGuard', () => {
  it('rejects second AI operation while one is running', () => {
    _resetOperationGuardForTests()
    const a = startAiOperation('batch_retry', { totalCount: 3 })
    expect(a.ok).toBe(true)
    if (!a.ok) return
    expect(canStartAiOperation().ok).toBe(false)
    expect(isAnyAiOperationActive()).toBe(true)
    finishAiOperation(a.operationId)
    expect(canStartAiOperation().ok).toBe(true)
  })

  it('stale runId is not active after cancel', () => {
    _resetOperationGuardForTests()
    const started = startAiOperation('single_line_retry')
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { operationId } = started
    expect(isActiveRun(operationId)).toBe(true)
    cancelAiOperation(operationId)
    expect(isActiveRun(operationId)).toBe(false)
    releaseAiOperationAfterStop(operationId)
  })

  it('pause and resume keep the same operationId active', () => {
    _resetOperationGuardForTests()
    const started = startAiOperation('full_file_alignment', { totalCount: 10 })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const { operationId } = started
    pauseAiOperation(operationId)
    expect(isActiveRun(operationId)).toBe(true)
    resumeAiOperation(operationId)
    expect(isActiveRun(operationId)).toBe(true)
    finishAiOperation(operationId)
  })

  it('failed operation allows a new start', () => {
    _resetOperationGuardForTests()
    const first = startAiOperation('batch_wide_retry')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    failAiOperation(first.operationId, 'parse error at matches[2]')
    expect(isAnyAiOperationActive()).toBe(false)
    const second = startAiOperation('single_line_retry')
    expect(second.ok).toBe(true)
    if (second.ok) finishAiOperation(second.operationId)
  })

  it('cancel blocks isActiveRun until released', () => {
    _resetOperationGuardForTests()
    const started = startAiOperation('batch_retry', { totalCount: 2 })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    cancelAiOperation(started.operationId)
    expect(isActiveRun(started.operationId)).toBe(false)
    releaseAiOperationAfterStop(started.operationId)
    expect(canStartAiOperation().ok).toBe(true)
  })
})
