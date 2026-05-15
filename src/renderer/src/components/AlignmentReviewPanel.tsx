import { useMemo, useState, type JSX } from 'react'
import { pauseAlignmentSession, resumeAlignmentSession, suggestTrimOverlappingAdjacentSpans } from '../lib/alignment'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'
import { useAlignmentSessionStore } from '../store/alignmentSessionStore'
import { useSubtitleStore } from '../store/subtitleStore'
import { useUiSettingsStore } from '../store/uiSettingsStore'
import type { SubtitleLine } from '../types'

function summarizeAiAttemptDebug(validated: import('../lib/alignment/types').AlignmentMatchValidated[]): string {
  if (validated.length === 0) return '（无返回行）'
  const parts = validated.slice(0, 16).map((r) => {
    const flags = r.validationFlags.length ? ` [${r.validationFlags.join(', ')}]` : ''
    const en = r.english.trim() ? (r.english.length > 72 ? `${r.english.slice(0, 72)}…` : r.english) : '（空）'
    const span = r.spanStart != null && r.spanEnd != null ? ` [${r.spanStart},${r.spanEnd})` : ''
    return `#${r.subtitleId} → ${en}${span}${flags}`
  })
  const more = validated.length > 16 ? `\n… 共 ${validated.length} 行` : ''
  return `${parts.join('\n')}${more}`
}

function summarizeAiAttemptUser(validated: import('../lib/alignment/types').AlignmentMatchValidated[]): string {
  if (validated.length === 0) return '（本批无有效返回摘要）'
  const parts = validated.slice(0, 20).map((r) => {
    const en = r.english.trim()
      ? r.english.length > 72
        ? `${r.english.slice(0, 72)}…`
        : r.english
      : '（本行暂无英文）'
    return `#${r.subtitleId} · ${en}`
  })
  const more = validated.length > 20 ? `\n… 共 ${validated.length} 行` : ''
  return `${parts.join('\n')}${more}`
}

/** 展示最近一批 DeepSeek 对齐结果与程序校验摘要。 */
export function AlignmentReviewPanel({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const debugMode = useUiSettingsStore((s) => s.debugMode)
  const sessionStatus = useAlignmentSessionStore((s) => s.status)
  const previewMatches = useAlignmentPreviewStore((s) => s.previewMatches)
  const batchIds = useAlignmentPreviewStore((s) => s.batchSubtitleIds)
  const debug = useAlignmentPreviewStore((s) => s.debug)
  const lastReport = useAlignmentPreviewStore((s) => s.lastReport)
  const lastGroups = useAlignmentPreviewStore((s) => s.lastCandidateGroups)
  const [debugDetailsOpen, setDebugDetailsOpen] = useState(false)

  const subtitles = useSubtitleStore((s) => s.subtitles)

  const batchLines = useMemo(() => {
    const byId = new Map(subtitles.map((l) => [l.id, l]))
    return batchIds.map((id) => byId.get(id)).filter(Boolean) as SubtitleLine[]
  }, [subtitles, batchIds])

  const manuscriptHint = debug?.localEnglishContextPlain ?? debug?.localEnglishExcerpt ?? '—'

  const hasPreview = previewMatches && previewMatches.length > 0
  const parseWarnCount = debug?.modelParseWarnings?.length ?? 0
  const hasParseWarnings = parseWarnCount > 0

  const visible =
    (hasPreview || hasParseWarnings) &&
    (sessionStatus === 'running' ||
      sessionStatus === 'paused' ||
      sessionStatus === 'completed' ||
      sessionStatus === 'stopped' ||
      sessionStatus === 'failed')

  const trimSuggestions = useMemo(() => {
    if (!previewMatches || previewMatches.length === 0 || batchIds.length < 2) return []
    const plain = debug?.localEnglishContextPlain
    if (!plain) return []
    const byId = new Map(previewMatches.map((r) => [r.subtitleId, r]))
    return suggestTrimOverlappingAdjacentSpans(batchIds, byId, plain)
  }, [previewMatches, batchIds, debug?.localEnglishContextPlain])

  if (!visible) return null

  const missing = debug?.missingSubtitleIdsInBatch ?? []
  const dupSpanNotes = debug?.spanPairDiagnostics ?? []
  const trimSpanNotes = dupSpanNotes.filter((l) => l.startsWith('可修剪重叠'))
  const otherDupSpanNotes = dupSpanNotes.filter((l) => !l.startsWith('可修剪重叠'))

  return (
    <div
      className={`review-batch-card rounded-xl border ${compact ? 'p-2.5 text-[11px]' : 'p-3 text-[12px]'}`}
    >
      <p className={`font-semibold text-primary ${compact ? 'text-[12px]' : 'text-[13px]'}`}>本批对齐复查</p>
      {debugMode ? (
        <p className="mt-1 text-meta leading-snug">
          英文上下文按本批时间窗口估算；模型仅在窗口内对齐，程序负责校验与写入。
        </p>
      ) : (
        <p className="mt-1 text-meta leading-snug">以下为当前批次的中文、模型英文与简要状态。</p>
      )}

      {debugMode && debug?.timeRatioContext ? (
        <div className="mt-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 text-[11px] text-secondary">
          <p className="text-meta mb-1 font-medium">时间比例窗口（调试）</p>
          <ul className="space-y-0.5 font-mono leading-snug">
            <li>
              字幕时间 · {debug.timeRatioContext.batchStartMs}–{debug.timeRatioContext.batchEndMs} ms
              （mid ratio {(100 * debug.timeRatioContext.batchMidRatio).toFixed(1)}%）
            </li>
            <li>
              英文池段 · pool[{debug.timeRatioContext.windowStartSeg}…{debug.timeRatioContext.windowEndSeg}]
              · center #{debug.timeRatioContext.englishCenterIndex}
            </li>
            <li>
              tier {debug.timeRatioContext.windowTier}
              {debug.timeRatioContext.windowTier === 3
                ? ' · 整稿（扩大重试）'
                : ` · before ${debug.timeRatioContext.contextBeforeSegs} / after ${debug.timeRatioContext.contextAfterSegs} segs`}
              · {debug.timeRatioContext.contextCharCount} chars
            </li>
            {debug.timeRatioContext.windowEscalation ? (
              <li className="text-amber-800 dark:text-amber-200">扩窗 · {debug.timeRatioContext.windowEscalation}</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {!debugMode && hasParseWarnings ? (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-950 dark:text-amber-100">
          本批有 {parseWarnCount} 条模型返回未能解析，已跳过。可在「设置 → 界面与调试」开启开发者模式查看详情。
        </p>
      ) : null}

      {debugMode && debug?.modelParseWarnings && debug.modelParseWarnings.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2 text-[11px] text-amber-950 dark:text-amber-50">
          <p className="text-meta mb-1 font-medium">模型 JSON 解析（调试）</p>
          <ul className="space-y-1.5">
            {debug.modelParseWarnings.map((w) => (
              <li key={w.index} className="leading-snug">
                Invalid model item at matches[{w.index}]，已跳过该项。
                {w.subtitleId != null ? <> subtitleId={w.subtitleId}.</> : null}{' '}
                <span className="text-meta">{w.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {lastReport ? (
        <p className="mt-2 text-[11px] text-secondary">
          {debugMode ? (
            <>
              批内：可写入约 {lastReport.matchedSubtitleCount}/{lastReport.batchSubtitleCount} 行 · 漏返回{' '}
              {lastReport.missingSubtitleIds.length} · 校验警告约 {lastReport.validationWarningCount} 条
            </>
          ) : (
            <>
              本批约 {lastReport.matchedSubtitleCount}/{lastReport.batchSubtitleCount} 行可写入
              {lastReport.missingSubtitleIds.length > 0
                ? ` · ${lastReport.missingSubtitleIds.length} 行未收到返回`
                : ''}
            </>
          )}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 text-secondary">
        <div>
          <p className="text-meta mb-1">本批字幕（中文）</p>
          <ul className="max-h-28 space-y-1 overflow-y-auto text-[11px] leading-snug text-[var(--color-text-secondary)]">
            {batchLines.map((l) => (
              <li key={l.id}>
                #{l.id} {l.start}–{l.end}ms · {l.chinese.slice(0, 56)}
                {l.chinese.length > 56 ? '…' : ''}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3 grid gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2">
        <p className="font-medium text-primary">模型英文</p>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 text-[11px] text-[var(--color-text-secondary)] leading-snug">
          {hasPreview
            ? debugMode
              ? summarizeAiAttemptDebug(previewMatches)
              : summarizeAiAttemptUser(previewMatches)
            : '（暂无摘要）'}
        </pre>
        {debugMode ? (
          <div>
            <p className="text-meta mb-0.5">英文上下文摘录（与 prompt 同源）</p>
            <p className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 text-[11px] leading-snug text-secondary">
              {manuscriptHint}
            </p>
          </div>
        ) : null}
      </div>

      {missing.length > 0 ? (
        <p className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
          未收到本批返回的字幕：<span className="font-mono">{missing.join(', ')}</span>
        </p>
      ) : null}

      {debugMode && trimSpanNotes.length > 0 ? (
        <div className="mt-2">
          <p className="text-meta mb-0.5">可修剪重叠</p>
          <ul className="max-h-20 list-inside list-disc overflow-y-auto text-[11px] text-secondary">
            {trimSpanNotes.slice(0, 8).map((line, i) => (
              <li key={`t-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {debugMode && otherDupSpanNotes.length > 0 ? (
        <div className="mt-2">
          <p className="text-meta mb-0.5">Span 重叠诊断</p>
          <ul className="max-h-20 list-inside list-disc overflow-y-auto text-[11px] text-secondary">
            {otherDupSpanNotes.slice(0, 8).map((line, i) => (
              <li key={`o-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {debugMode ? (
        <>
          <button
            type="button"
            className="review-batch-card__link mt-2"
            onClick={() => setDebugDetailsOpen((o) => !o)}
          >
            {debugDetailsOpen ? '收起' : '展开'}调试详情（候选组 / 校验 / Raw）
          </button>

          {debugDetailsOpen ? (
            <div className="mt-2 space-y-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2 font-mono text-[10px] text-secondary">
              <p className="text-meta">englishCandidateGroupsDebug · {lastGroups.length}</p>
              <ul className="max-h-20 space-y-1 overflow-y-auto">
                {lastGroups.slice(0, 8).map((g) => (
                  <li key={g.id} className="leading-snug">
                    <span className="text-meta">{g.id}</span> · {g.text.slice(0, 80)}
                    {g.text.length > 80 ? '…' : ''}
                  </li>
                ))}
              </ul>
              {debug?.validationResult?.length ? (
                <div>
                  <p className="text-meta">校验输出</p>
                  <ul className="list-inside list-disc text-amber-800 dark:text-amber-200">
                    {debug.validationResult.slice(0, 24).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {trimSuggestions.some((s) => s.suggestedEarlierEnglish) ? (
                <div>
                  <p className="text-meta">相邻裁剪建议（未自动写入）</p>
                  <ul className="max-h-28 space-y-1.5 overflow-y-auto text-[10px] leading-snug">
                    {trimSuggestions
                      .filter((s) => s.suggestedEarlierEnglish)
                      .slice(0, 6)
                      .map((s) => (
                        <li key={`${s.subtitleIdEarlier}-${s.subtitleIdLater}`}>
                          <span className="text-meta">#{s.subtitleIdEarlier}</span> 当前：
                          {s.earlierEnglishCurrent.slice(0, 120)}
                          {s.earlierEnglishCurrent.length > 120 ? '…' : ''}
                          <br />
                          <span className="text-meta">建议：</span>
                          {s.suggestedEarlierEnglish}
                        </li>
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
        </>
      ) : (
        <p className="type-caption mt-2 text-meta leading-snug">
          需要查看 span、重叠与原始响应时，请在「设置 → 界面与调试」中开启开发者模式。
        </p>
      )}

      <div className={`mt-3 flex flex-wrap gap-2`}>
        {sessionStatus === 'running' ? (
          <button type="button" className="toolbar-btn toolbar-btn--panel text-[12px]" onClick={() => pauseAlignmentSession()}>
            暂停对齐
          </button>
        ) : null}
        {sessionStatus === 'paused' ? (
          <button type="button" className="toolbar-btn toolbar-btn--panel text-[12px]" onClick={() => resumeAlignmentSession()}>
            继续对齐
          </button>
        ) : null}
        <button
          type="button"
          className="toolbar-btn toolbar-btn--panel text-[12px]"
          onClick={() => {
            if (!window.confirm('停止整文件对齐？已写入的字幕将保留。')) return
            useAlignmentSessionStore.getState().stopSessionAsUserCancelled()
          }}
        >
          停止整文件
        </button>
      </div>
      <p className="mt-2 text-[11px] text-meta leading-snug">
        可随时暂停查看本批摘要；停止后已写入结果保留，可调整原稿后重跑。
      </p>
    </div>
  )
}
