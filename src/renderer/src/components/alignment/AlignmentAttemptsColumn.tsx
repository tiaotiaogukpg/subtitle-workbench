import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { normalizeAttemptEnglishKey } from '../../lib/alignment/aiAttempts'
import { attemptAttentionBand } from '../../lib/alignment/riskModel'
import { computeWideRetrySuggestion } from '../../lib/alignment/wideRetryHint'
import { segmentIdsEqual } from '../../lib/alignment/subtitleLineUtils'
import { buildAttemptWordDiff } from '../../lib/text/attemptWordDiff'
import type { ScriptSegment, SubtitleAiAttempt, SubtitleLine } from '../../types'
import { ContextAssistFoldable } from './ContextAssistFoldable'
import { useBatchRetrySessionStore } from '../../store/batchRetrySessionStore'

function isAttemptApplied(line: SubtitleLine, att: SubtitleAiAttempt): boolean {
  if (normalizeAttemptEnglishKey(att.english) !== normalizeAttemptEnglishKey(line.english)) return false
  return segmentIdsEqual(att.matchedSegmentIds ?? [], line.matchedSegmentIds ?? [])
}

function formatAttemptSource(source: string): string {
  switch (source) {
    case 'batch_retry':
      return 'batch retry'
    case 'batch_wide_retry':
      return 'batch wide'
    case 'single_retry':
      return 'single retry'
    case 'wide_retry':
      return 'wide retry'
    default:
      return source
  }
}

function AttemptCompareModal({
  open,
  currentEnglish,
  attempt,
  onClose
}: {
  open: boolean
  currentEnglish: string
  attempt: SubtitleAiAttempt | null
  onClose: () => void
}): JSX.Element | null {
  if (!open || !attempt) return null
  const ops = buildAttemptWordDiff(currentEnglish, attempt.english)
  const body = (
    <div
      data-attempt-compare-open
      className="attempt-compare-overlay fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Attempt 对比"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="attempt-compare-dialog max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-xl shadow-2xl">
        <div className="attempt-compare-dialog__head flex items-center justify-between px-4 py-2.5">
          <p className="attempt-compare-dialog__title">与当前英文 · 词级对比</p>
          <button type="button" className="ai-attempt-btn px-3 py-1.5 text-[12px]" onClick={onClose}>
            关闭 (Esc)
          </button>
        </div>
        <div className="attempt-compare-dialog__body max-h-[calc(85vh-52px)] space-y-3 overflow-y-auto p-4 text-[13px] leading-relaxed">
          <div>
            <p className="attempt-compare-dialog__label">当前应用</p>
            <p className="attempt-compare-dialog__block">{currentEnglish.trim() ? currentEnglish : '（空）'}</p>
          </div>
          <div>
            <p className="attempt-compare-dialog__label">Attempt · {attempt.source}</p>
            <p className="attempt-compare-dialog__block">
              {attempt.english.trim() ? attempt.english : '（空）'}
            </p>
          </div>
          <div>
            <p className="attempt-compare-dialog__label">差异（删 / 增）</p>
            <p className="attempt-compare-dialog__diff attempt-word-diff">
              {ops.length === 0 ? (
                <span className="attempt-compare-dialog__muted">（无词级差异）</span>
              ) : (
                ops.map((op, i) => (
                  <span key={i}>
                    {i > 0 ? ' ' : null}
                    {op.type === 'eq' ? (
                      <span className="attempt-word-diff__eq attempt-word-diff__eq--on-dark">{op.text}</span>
                    ) : op.type === 'del' ? (
                      <span className="attempt-word-diff__del">{op.text}</span>
                    ) : (
                      <span className="attempt-word-diff__ins">{op.text}</span>
                    )}
                  </span>
                ))
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

export interface AlignmentAttemptsColumnProps {
  line: SubtitleLine
  alignmentConfidenceThreshold: number
  suggested: SubtitleAiAttempt | null
  dupIds: Map<string, boolean>
  selectedAttemptIndex: number
  onSelectedAttemptIndexChange: (index: number) => void
  applyAiAttempt: (subtitleId: number, attemptId: string, confidenceThresholdPct: number) => void
  removeAiAttempt: (subtitleId: number, attemptId: string) => void
  setPreferredAttempt: (subtitleId: number, attemptId: string | null) => void
  lineRetryBusy: 'idle' | 'narrow' | 'wide'
  alignmentSessionBusy: boolean
  onRetryNarrow: () => void
  onRetryWide: () => void
  subtitles: SubtitleLine[]
  segments: ScriptSegment[]
  alignmentModel: string
}

export function AlignmentAttemptsColumn({
  line,
  alignmentConfidenceThreshold,
  suggested,
  dupIds,
  selectedAttemptIndex,
  onSelectedAttemptIndexChange,
  applyAiAttempt,
  removeAiAttempt,
  setPreferredAttempt,
  lineRetryBusy,
  alignmentSessionBusy,
  onRetryNarrow,
  onRetryWide,
  subtitles,
  segments,
  alignmentModel
}: AlignmentAttemptsColumnProps): JSX.Element {
  const [compareAttemptId, setCompareAttemptId] = useState<string | null>(null)

  useEffect(() => {
    if (!compareAttemptId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setCompareAttemptId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compareAttemptId])

  const attemptsSorted = useMemo(
    () => [...(line.aiAttempts ?? [])].sort((a, b) => b.createdAt - a.createdAt),
    [line.aiAttempts]
  )

  const compareAttempt = useMemo(
    () => attemptsSorted.find((a) => a.id === compareAttemptId) ?? null,
    [attemptsSorted, compareAttemptId]
  )

  const clampedIndex = Math.min(
    Math.max(0, selectedAttemptIndex),
    Math.max(0, attemptsSorted.length - 1)
  )

  const wideHint = useMemo(
    () =>
      computeWideRetrySuggestion({
        line,
        dupIds,
        confidenceThresholdPct: alignmentConfidenceThreshold
      }),
    [line, dupIds, alignmentConfidenceThreshold]
  )

  const batchStatus = useBatchRetrySessionStore((s) => s.status)
  const batchWide = useBatchRetrySessionStore((s) => s.wide)
  const batchTotal = useBatchRetrySessionStore((s) => s.total)
  const batchCompleted = useBatchRetrySessionStore((s) => s.completed)
  const batchCurrentId = useBatchRetrySessionStore((s) => s.currentSubtitleId)
  const batchLastError = useBatchRetrySessionStore((s) => s.lastError)
  const batchTruncated = useBatchRetrySessionStore((s) => s.truncated)
  const batchRawCount = useBatchRetrySessionStore((s) => s.rawTargetCount)
  const requestPause = useBatchRetrySessionStore((s) => s.requestPause)
  const requestResume = useBatchRetrySessionStore((s) => s.requestResume)
  const requestStop = useBatchRetrySessionStore((s) => s.requestStop)
  const resetBatchSession = useBatchRetrySessionStore((s) => s.reset)
  const startBatchRetry = useBatchRetrySessionStore((s) => s.startBatchRetry)

  const batchRunActive = batchStatus === 'running' || batchStatus === 'paused'
  const batchFinished = batchStatus === 'completed' || batchStatus === 'stopped'
  const retryDisabled = lineRetryBusy !== 'idle' || alignmentSessionBusy || batchRunActive

  const attemptCount = attemptsSorted.length
  const showAttemptCountTitle = attemptCount > 3
  const showScrollHint = attemptCount > 3

  const scrollBodyRef = useRef<HTMLDivElement | null>(null)
  const selectedAttemptRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (attemptCount === 0) return
    const el = selectedAttemptRef.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [clampedIndex, attemptCount, line.id])

  return (
    <section
      className="phase4b-panel ai-attempts-panel flex min-h-0 flex-col overflow-hidden rounded-lg p-3"
      data-review-hotkeys="true"
    >
      <header className="phase4b-header ai-attempts-panel__header shrink-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="ai-attempts-panel__title">
            {showAttemptCountTitle
              ? `AI Attempts · ${attemptCount} 次尝试`
              : 'Phase 4B · AI Attempts'}
          </h2>
          {!showAttemptCountTitle ? (
            <span className="ai-attempts-panel__count">{attemptCount} 条</span>
          ) : null}
        </div>
        <p className="ai-attempts-panel__hint mb-2 leading-snug">
          键盘 A / D 切换选中；Enter 应用选中；与当前应用一致的尝试会高亮。
        </p>
        <div className="ai-attempts-panel__strategy flex flex-wrap items-center gap-2">
          <button
          type="button"
          className="ai-attempt-btn px-3 py-1.5 text-[12px]"
          disabled={retryDisabled}
          title="较窄英文上下文再请求模型（tier 1–3），仅追加 attempt，需手动 Apply"
          onClick={() => onRetryNarrow()}
        >
          {lineRetryBusy === 'narrow' ? '重试中…' : 'Retry'}
        </button>
        <button
          type="button"
          className="ai-attempt-btn ai-attempt-btn--wide-retry px-3 py-1.5 text-[12px]"
          disabled={retryDisabled}
          title="使用更大的英文上下文重新尝试对齐（tier 3/4），仅追加 attempt，需手动 Apply"
          onClick={() => onRetryWide()}
        >
          {lineRetryBusy === 'wide' ? '扩窗重试中…' : 'Wide Retry'}
        </button>
        <span className="ai-attempts-panel__sep" aria-hidden>
          |
        </span>
        <button
          type="button"
          className="ai-attempt-btn px-3 py-1.5 text-[12px]"
          disabled={retryDisabled || batchRunActive || alignmentSessionBusy}
          title="对复查队列中符合条件的行串行追加 batch_retry attempts，不自动应用"
          onClick={() =>
            void startBatchRetry({
              wide: false,
              model: alignmentModel,
              confidenceThresholdPct: alignmentConfidenceThreshold
            })
          }
        >
          Batch Retry
        </button>
        <button
          type="button"
          className="ai-attempt-btn ai-attempt-btn--wide-retry px-3 py-1.5 text-[12px]"
          disabled={retryDisabled || batchRunActive || alignmentSessionBusy}
          title="对复查队列中符合条件的行串行追加 batch_wide_retry attempts（大上下文），不自动应用"
          onClick={() =>
            void startBatchRetry({
              wide: true,
              model: alignmentModel,
              confidenceThresholdPct: alignmentConfidenceThreshold
            })
          }
        >
          Batch Wide Retry
          </button>
        </div>
      </header>

      <div ref={scrollBodyRef} className="phase4b-scroll-body">
        <ContextAssistFoldable subtitles={subtitles} line={line} segments={segments} />

        {batchRunActive || batchFinished || batchLastError ? (
        <div className="batch-retry-panel mb-3 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.2)] px-3 py-2 text-[11px] leading-snug text-[rgba(255,255,255,0.72)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              进度{' '}
              <span className="tabular-nums font-semibold text-[rgba(255,255,255,0.88)]">
                {batchCompleted}/{batchTotal || 0}
              </span>
              {batchCurrentId != null ? (
                <>
                  {' · '}
                  当前 <span className="tabular-nums">#{String(batchCurrentId).padStart(3, '0')}</span>
                </>
              ) : null}
            </span>
            <span className="text-[rgba(255,255,255,0.5)]">
              模式 {batchWide ? 'batch_wide_retry' : 'batch_retry'}
            </span>
          </div>
          {batchTotal > 0 ? (
            <div className="batch-retry-progress-track mt-2">
              <div
                className="batch-retry-progress-fill"
                style={{ width: `${Math.min(100, Math.round((batchCompleted / batchTotal) * 100))}%` }}
              />
            </div>
          ) : null}
          {batchTruncated ? (
            <p className="mt-1.5 text-[10px] text-amber-200/85">
              本批已截断至 {batchTotal} 条（符合条件共 {batchRawCount} 条）
            </p>
          ) : null}
          {batchLastError ? <p className="mt-1.5 text-[11px] text-red-300/95">{batchLastError}</p> : null}
          {batchFinished && !batchLastError ? (
            <p className="mt-1.5 text-[11px] text-emerald-200/85">
              {batchStatus === 'completed' ? '本批已完成（仅追加 attempts，请自行 Compare / Apply）' : '已停止'}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {batchStatus === 'running' ? (
              <button type="button" className="ai-attempt-btn px-2 py-1 text-[11px]" onClick={() => requestPause()}>
                Pause
              </button>
            ) : null}
            {batchStatus === 'paused' ? (
              <button type="button" className="ai-attempt-btn px-2 py-1 text-[11px]" onClick={() => requestResume()}>
                Resume
              </button>
            ) : null}
            {batchRunActive ? (
              <button type="button" className="ai-attempt-btn px-2 py-1 text-[11px]" onClick={() => requestStop()}>
                Stop
              </button>
            ) : null}
            {batchFinished || batchLastError ? (
              <button type="button" className="ai-attempt-btn px-2 py-1 text-[11px]" onClick={() => resetBatchSession()}>
                清除状态
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {wideHint.suggest ? (
        <div className="ai-attempts-panel__wide-hint mb-3" role="status">
          <p className="ai-attempts-panel__wide-hint-title">建议尝试 Wide Retry</p>
          <ul className="ai-attempts-panel__wide-hint-list">
            {wideHint.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

        {showScrollHint ? (
          <p className="ai-attempts-panel__scroll-hint" aria-hidden>
            滚动查看更多尝试
          </p>
        ) : null}
        {attemptCount === 0 ? (
          <p className="ai-attempts-panel__empty">尚无尝试记录。</p>
        ) : (
          <ul className="ai-attempts-panel__list" role="list">
            {attemptsSorted.map((att, idx) => {
              const isSel = idx === clampedIndex && attemptsSorted.length > 0
          const isApplied = isAttemptApplied(line, att)
          const isPick = suggested?.id === att.id
          const isDup = dupIds.get(att.id)
          const isPinned = line.preferredAttemptId === att.id
          const band = attemptAttentionBand(att)
          const canDelete = line.status !== 'manual' && line.preferredAttemptId !== att.id

          const cardMods = [
            'ai-attempt-card',
            isSel ? 'ai-attempt-card--selected' : '',
            isApplied ? 'ai-attempt-card--applied' : '',
            isPinned ? 'ai-attempt-card--pinned' : ''
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <li
              key={att.id}
              ref={isSel ? selectedAttemptRef : undefined}
              className={cardMods}
              role="listitem"
            >
              <button
                type="button"
                className="ai-attempt-card__select"
                onClick={() => onSelectedAttemptIndexChange(idx)}
              >
                <div className="ai-attempt-card__meta flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {isApplied ? <span className="ai-attempt-chip ai-attempt-chip--applied">当前应用</span> : null}
                  {isPinned ? <span className="ai-attempt-chip ai-attempt-chip--pinned">已固定</span> : null}
                  <span className={`attempt-attention-pip attempt-attention-pip--${band}`} title="注意度（非自动）" />
                  <span className="ai-attempt-card__meta-mono font-mono tabular-nums">
                    {new Date(att.createdAt).toLocaleString()}
                  </span>
                  <span>{formatAttemptSource(att.source)}</span>
                  {att.contextTier != null ? <span>tier {att.contextTier}</span> : null}
                  <span>{att.confidence}%</span>
                  {isPick ? <span className="ai-attempt-card__pick">推荐</span> : null}
                  {isDup ? <span className="ai-attempt-card__dup">duplicate</span> : null}
                </div>
                {att.problems.length > 0 ? (
                  <ul className="ai-attempt-card__problems mt-1 list-inside list-disc text-[11px]">
                    {att.problems.slice(0, 5).map((p: string, i: number) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="ai-attempt-card__english mt-1 whitespace-pre-wrap break-words">
                  {att.english.trim() ? att.english : '（空 / 失败摘要）'}
                </p>
              </button>
              <div className="ai-attempt-card__actions mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="ai-attempt-btn px-2 py-1 text-[11px]"
                  disabled={!att.english.trim()}
                  onClick={() => applyAiAttempt(line.id, att.id, alignmentConfidenceThreshold)}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="ai-attempt-btn px-2 py-1 text-[11px]"
                  onClick={() => setCompareAttemptId(att.id)}
                >
                  Compare
                </button>
                <button
                  type="button"
                  className="ai-attempt-btn px-2 py-1 text-[11px]"
                  disabled={!canDelete}
                  title={
                    line.status === 'manual'
                      ? '手动编辑行不删除尝试记录'
                      : line.preferredAttemptId === att.id
                        ? '请先 Unpin 再删除'
                        : undefined
                  }
                  onClick={() => removeAiAttempt(line.id, att.id)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className={`ai-attempt-btn px-2 py-1 text-[11px]${isPinned ? ' ai-attempt-btn--pinned' : ''}`}
                  onClick={() => setPreferredAttempt(line.id, isPinned ? null : att.id)}
                >
                  {isPinned ? 'Unpin' : 'Pin'}
                </button>
              </div>
            </li>
          )
        })}
          </ul>
        )}
      </div>

      <AttemptCompareModal
        open={compareAttemptId != null}
        currentEnglish={line.english}
        attempt={compareAttempt}
        onClose={() => setCompareAttemptId(null)}
      />
    </section>
  )
}
