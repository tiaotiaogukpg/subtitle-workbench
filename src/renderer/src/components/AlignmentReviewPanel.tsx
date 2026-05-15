import { useMemo, useState, type JSX } from 'react'
import { pauseAlignmentSession, resumeAlignmentSession } from '../lib/alignment'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../store/alignmentSessionStore'
import { useSubtitleStore } from '../store/subtitleStore'
import type { SubtitleLine } from '../types'

function summarizeAiAttempt(validated: import('../lib/alignment/types').AlignmentMatchValidated[]): string {
  if (validated.length === 0) return '（无返回行）'
  const parts = validated.slice(0, 16).map((r) => {
    const flags = r.validationFlags.length ? ` [${r.validationFlags.join(', ')}]` : ''
    const en = r.english.trim() ? (r.english.length > 72 ? `${r.english.slice(0, 72)}…` : r.english) : '（空）'
    const span =
      r.spanStart != null && r.spanEnd != null ? ` [${r.spanStart},${r.spanEnd})` : ''
    return `#${r.subtitleId} → ${en}${span}${flags}`
  })
  const more = validated.length > 16 ? `\n… 共 ${validated.length} 行` : ''
  return `${parts.join('\n')}${more}`
}

/** 展示最近一批 DeepSeek 对齐结果与程序校验摘要。 */
export function AlignmentReviewPanel({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const sessionStatus = useAlignmentSessionStore((s) => s.status)
  const previewMatches = useAlignmentPreviewStore((s) => s.previewMatches)
  const batchIds = useAlignmentPreviewStore((s) => s.batchSubtitleIds)
  const debug = useAlignmentPreviewStore((s) => s.debug)
  const lastReport = useAlignmentPreviewStore((s) => s.lastReport)
  const lastGroups = useAlignmentPreviewStore((s) => s.lastCandidateGroups)
  const [detailOpen, setDetailOpen] = useState(!compact)

  const subtitles = useSubtitleStore((s) => s.subtitles)

  const batchLines = useMemo(() => {
    const byId = new Map(subtitles.map((l) => [l.id, l]))
    return batchIds.map((id) => byId.get(id)).filter(Boolean) as SubtitleLine[]
  }, [subtitles, batchIds])

  const manuscriptHint = debug?.localEnglishContextPlain ?? debug?.localEnglishExcerpt ?? '—'

  const visible =
    previewMatches &&
    previewMatches.length > 0 &&
    (sessionStatus === 'running' ||
      sessionStatus === 'paused' ||
      sessionStatus === 'completed' ||
      sessionStatus === 'stopped' ||
      sessionStatus === 'failed')

  if (!visible) return null

  const missing = debug?.missingSubtitleIdsInBatch ?? []
  const dupSpanNotes = debug?.spanPairDiagnostics ?? []

  return (
    <div
      className={`rounded-lg border border-sky-500/40 bg-sky-500/10 ${compact ? 'p-2.5 text-[11px]' : 'p-3 text-[12px]'} text-sky-950 dark:text-sky-50`}
    >
      <p className={`font-semibold ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
        Alignment Review · 本批对齐复查
      </p>
      <p className="mt-1 text-meta leading-snug">
        整稿英文上下文由程序拼接；DeepSeek 负责语义切分与对齐。程序仅做约束校验与写入/复查标记。
      </p>

      {lastReport ? (
        <p className="mt-2 text-[11px] text-meta">
          批内：可写入约 {lastReport.matchedSubtitleCount}/{lastReport.batchSubtitleCount} 行 · 漏返回{' '}
          {lastReport.missingSubtitleIds.length} · 校验警告约 {lastReport.validationWarningCount} 条
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 rounded-md border border-sky-600/30 bg-[var(--color-bg-elevated)] p-2 text-secondary">
        <div>
          <p className="text-meta mb-1">本批字幕（中文）</p>
          <ul className="max-h-28 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug">
            {batchLines.map((l) => (
              <li key={l.id}>
                #{l.id} {l.start}–{l.end}ms · {l.chinese.slice(0, 56)}
                {l.chinese.length > 56 ? '…' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-md border border-sky-600/30 bg-[var(--color-bg-base)] p-2">
        <p className="font-medium text-primary">DeepSeek 返回</p>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 font-mono text-[10px] text-secondary">
          {summarizeAiAttempt(previewMatches)}
        </pre>
        <div>
          <p className="text-meta mb-0.5">英文上下文摘录（本批 prompt 同源）</p>
          <p className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 text-[11px] leading-snug text-secondary">
            {manuscriptHint}
          </p>
        </div>
      </div>

      {missing.length > 0 ? (
        <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
          漏返回字幕 id：<span className="font-mono">{missing.join(', ')}</span>
        </p>
      ) : null}

      {dupSpanNotes.length > 0 ? (
        <div className="mt-2">
          <p className="text-meta mb-0.5">重复 / 高重叠 span</p>
          <ul className="max-h-20 list-inside list-disc overflow-y-auto text-[11px] text-amber-900 dark:text-amber-100">
            {dupSpanNotes.slice(0, 8).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        className="type-caption mt-2 text-meta underline decoration-dotted"
        onClick={() => setDetailOpen((o) => !o)}
      >
        {detailOpen ? '折叠' : '展开'}候选组（Debug）/ 校验 / Raw
      </button>

      {detailOpen ? (
        <div className="mt-2 space-y-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 font-mono text-[10px] text-secondary">
          <p className="text-meta">englishCandidateGroupsDebug · {lastGroups.length}</p>
          <ul className="max-h-20 overflow-y-auto space-y-1">
            {lastGroups.slice(0, 8).map((g) => (
              <li key={g.id} className="leading-snug">
                <span className="text-meta">{g.id}</span> · {g.text.slice(0, 80)}
                {g.text.length > 80 ? '…' : ''}
              </li>
            ))}
          </ul>
          {debug?.validationResult?.length ? (
            <div>
              <p className="text-meta">validation</p>
              <ul className="list-inside list-disc text-amber-800 dark:text-amber-200">
                {debug.validationResult.slice(0, 24).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-meta">DeepSeek raw（截断）</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words">
            {debug?.rawResponse
              ? debug.rawResponse.length > 3000
                ? `${debug.rawResponse.slice(0, 3000)}…`
                : debug.rawResponse
              : '—'}
          </pre>
        </div>
      ) : null}

      <div className={`mt-3 flex flex-wrap gap-2 ${compact ? '' : ''}`}>
        {sessionStatus === 'running' ? (
          <button type="button" className="toolbar-btn text-[12px]" onClick={() => pauseAlignmentSession()}>
            暂停对齐
          </button>
        ) : null}
        {sessionStatus === 'paused' ? (
          <button type="button" className="toolbar-btn text-[12px]" onClick={() => resumeAlignmentSession()}>
            继续对齐
          </button>
        ) : null}
        <button
          type="button"
          className="toolbar-btn text-[12px]"
          onClick={() => {
            if (!window.confirm('停止整文件对齐？已写入的字幕将保留。')) return
            useAlignmentSessionStore.getState().stopSessionAsUserCancelled()
          }}
        >
          停止整文件
        </button>
      </div>
      <p className="mt-2 text-[11px] text-meta">
        本批异常时可暂停查看摘要，或停止任务后调整英文稿 / 参数并重跑整文件对齐。
      </p>
    </div>
  )
}
