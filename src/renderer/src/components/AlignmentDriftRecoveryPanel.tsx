import { useMemo, useState, type JSX } from 'react'
import {
  filterEnglishPoolSegments,
  resumeFullFileFromDrift,
  retryDriftBatchAlignment,
  skipDriftBatchAndContinue,
  stopFullFileAlignmentFromDrift
} from '../lib/alignment'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../store/alignmentSessionStore'
import { useScriptPoolStore } from '../store/scriptPoolStore'
import { useSubtitleStore } from '../store/subtitleStore'
import type { SubtitleLine } from '../types'

function parseSettingsInt(raw: string, min: number, max: number): number | null {
  if (raw === '' || raw === '-') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

function summarizeAiAttempt(validated: import('../lib/alignment/types').AlignmentMatchValidated[]): string {
  if (validated.length === 0) return '（无返回行）'
  const parts = validated.slice(0, 8).map((r) => {
    const flags = r.validationFlags.length ? ` [${r.validationFlags.join(', ')}]` : ''
    const en = r.english.trim() ? (r.english.length > 80 ? `${r.english.slice(0, 80)}…` : r.english) : '（空）'
    return `#${r.subtitleId} → ${en}${flags}`
  })
  const more = validated.length > 8 ? `\n… 共 ${validated.length} 行` : ''
  return `${parts.join('\n')}${more}`
}

export function AlignmentDriftRecoveryPanel({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const drift = useAlignmentSessionStore((s) => s.driftContinuation)
  const status = useAlignmentSessionStore((s) => s.status)
  const previewEnglish = useAlignmentPreviewStore((s) => s.englishCursor)
  const setEnglishCursor = useAlignmentPreviewStore((s) => s.setEnglishCursor)
  const batchIds = useAlignmentPreviewStore((s) => s.batchSubtitleIds)
  const lastGroups = useAlignmentPreviewStore((s) => s.lastCandidateGroups)
  const debug = useAlignmentPreviewStore((s) => s.debug)
  const previewMatches = useAlignmentPreviewStore((s) => s.previewMatches)
  const modelRowsForSummary = useMemo(() => previewMatches ?? [], [previewMatches])
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const segments = useScriptPoolStore((s) => s.segments)
  const [busy, setBusy] = useState<'retry' | null>(null)
  const [detailOpen, setDetailOpen] = useState(!compact)

  const poolLen = useMemo(() => filterEnglishPoolSegments(segments).length, [segments])

  const batchLines = useMemo(() => {
    const byId = new Map(subtitles.map((l) => [l.id, l]))
    return batchIds.map((id) => byId.get(id)).filter(Boolean) as SubtitleLine[]
  }, [subtitles, batchIds])

  const manuscriptHint = debug?.localEnglishExcerpt ?? '—'

  if (status !== 'drift_recovery' || !drift) return null

  const effectivePoolLen = poolLen

  async function onRetry(): Promise<void> {
    setBusy('retry')
    try {
      const err = await retryDriftBatchAlignment()
      if (err) window.alert(err)
    } finally {
      setBusy(null)
    }
  }

  function onResume(): void {
    const err = resumeFullFileFromDrift()
    if (err) window.alert(err)
  }

  function onSkip(): void {
    if (!window.confirm('将本批全部标为「需复查」并继续下一批，确定？')) return
    const err = skipDriftBatchAndContinue()
    if (err) window.alert(err)
  }

  function onStop(): void {
    if (!window.confirm('停止整文件对齐？已写入的字幕将保留。')) return
    stopFullFileAlignmentFromDrift()
  }

  return (
    <div
      className={`rounded-lg border border-amber-500/50 bg-amber-500/10 ${compact ? 'p-2.5 text-[11px]' : 'p-3 text-[12px]'} text-amber-950 dark:text-amber-50`}
    >
      <p className={`font-semibold ${compact ? 'text-[12px]' : 'text-[13px]'}`}>Drift Recovery · 对齐漂移恢复</p>
      <p className="mt-1 text-meta leading-snug">
        本批与英文顺序约束冲突。下方对照「模型尝试」与「英文原稿游标附近」，校正 English cursor 后续跑或跳过本批。
      </p>

      <div className="mt-3 grid gap-2 rounded-md border border-amber-600/30 bg-[var(--color-bg-elevated)] p-2 text-secondary">
        <p>
          <span className="text-meta">失败批次 · </span>
          {drift.batchLabel}（第 {drift.lastBatchIndexUsed} / {drift.totalBatches} 批）
        </p>
        <p>
          <span className="text-meta">字幕下标范围 · </span>
          pool[{drift.subtitleStart} … {drift.subtitleStart + drift.failedBatchSize - 1}]
        </p>
        <div>
          <p className="text-meta mb-1">本批字幕（中文）</p>
          <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug">
            {batchLines.map((l) => (
              <li key={l.id}>
                #{l.id} {l.start}–{l.end}ms · {l.chinese.slice(0, 60)}
                {l.chinese.length > 60 ? '…' : ''}
              </li>
            ))}
          </ul>
        </div>
        <label className="block">
          <span className="text-meta">English cursor（对齐游标 · 英文池下标）</span>
          <input
            type="number"
            className="settings-input mt-1 w-full max-w-[12rem] font-mono tabular-nums"
            min={0}
            max={Math.max(0, effectivePoolLen - 1)}
            value={previewEnglish}
            onChange={(e) => {
              const v = parseSettingsInt(e.currentTarget.value, 0, Math.max(0, effectivePoolLen - 1))
              if (v === null) return
              setEnglishCursor(v)
            }}
          />
          <span className="mt-0.5 block text-[11px] text-meta">纯英文池共 {effectivePoolLen} 段；改后请「重试本批」或「从 cursor 继续」。</span>
        </label>
      </div>

      <div className="mt-3 grid gap-2 rounded-md border border-amber-600/30 bg-[var(--color-bg-base)] p-2">
        <p className="font-medium text-primary">对照</p>
        <div>
          <p className="text-meta mb-0.5">AI 当前尝试匹配到哪里（模型返回摘要）</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 font-mono text-[10px] text-secondary">
            {modelRowsForSummary.length > 0 ? summarizeAiAttempt(modelRowsForSummary) : '—'}
          </pre>
        </div>
        <div>
          <p className="text-meta mb-0.5">英文原稿当前位置（游标附近只读上下文）</p>
          <p className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 text-[11px] leading-snug text-secondary">
            {manuscriptHint}
          </p>
        </div>
      </div>

      <button
        type="button"
        className="type-caption mt-2 text-meta underline decoration-dotted"
        onClick={() => setDetailOpen((o) => !o)}
      >
        {detailOpen ? '折叠' : '展开'}候选组 / DeepSeek / 校验
      </button>

      {detailOpen ? (
        <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 font-mono text-[10px] text-secondary">
          <p className="text-meta">candidate groups · {lastGroups.length}</p>
          <ul className="max-h-24 overflow-y-auto space-y-1">
            {lastGroups.slice(0, 12).map((g) => (
              <li key={g.id} className="leading-snug">
                <span className="text-meta">{g.id}</span> · segs {g.startSegmentIndex}–{g.endSegmentIndex} ·{' '}
                {g.text.slice(0, 100)}
                {g.text.length > 100 ? '…' : ''}
              </li>
            ))}
            {lastGroups.length > 12 ? <li className="text-meta">…</li> : null}
          </ul>
          {debug?.validationResult?.length ? (
            <div>
              <p className="text-meta">validation</p>
              <ul className="list-inside list-disc text-amber-800 dark:text-amber-200">
                {debug.validationResult.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-meta">DeepSeek raw（截断）</p>
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words">
            {debug?.rawResponse
              ? debug.rawResponse.length > 4000
                ? `${debug.rawResponse.slice(0, 4000)}…`
                : debug.rawResponse
              : '—'}
          </pre>
          {debug?.promptPreview ? (
            <details className="text-meta">
              <summary className="cursor-pointer">User JSON（prompt 负载）</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[9px]">
                {debug.promptPreview.length > 12000
                  ? `${debug.promptPreview.slice(0, 12000)}…`
                  : debug.promptPreview}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className={`mt-3 flex flex-wrap gap-2 ${compact ? '' : ''}`}>
        <button
          type="button"
          className="toolbar-btn text-[12px]"
          disabled={busy === 'retry'}
          onClick={() => void onRetry()}
        >
          {busy === 'retry' ? '重试请求中…' : 'A. 重试本批（DeepSeek）'}
        </button>
        <button type="button" className="toolbar-btn text-[12px]" onClick={onResume}>
          C. 从当前 cursor 继续
        </button>
        <button type="button" className="toolbar-btn text-[12px]" onClick={onSkip}>
          D. 跳过本批（需复查）
        </button>
        <button type="button" className="toolbar-btn text-[12px]" onClick={onStop}>
          E. 停止整文件
        </button>
      </div>
      <p className="mt-2 text-[11px] text-meta">
        B. 在上方修改 English cursor，或在 Script Pool 中点击英文片段的「设为对齐游标」。
      </p>
    </div>
  )
}
