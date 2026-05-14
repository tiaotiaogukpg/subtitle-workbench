import { useCallback, useState, type JSX } from 'react'
import {
  estimatePromptTokens,
  buildAlignmentMessages,
  parseAlignmentModelJson,
  pickAlignmentSubtitleBatch,
  pickNearbyScriptSegments
} from '../lib/realAlignmentBatch'
import type { SettingsState } from '../types'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'
import { useScriptPoolStore } from '../store/scriptPoolStore'
import { useSubtitleStore } from '../store/subtitleStore'

export function RealAlignmentSandbox({ settings }: { settings: SettingsState }): JSX.Element {
  const phase = useAlignmentPreviewStore((s) => s.phase)
  const runError = useAlignmentPreviewStore((s) => s.runError)
  const previewMatches = useAlignmentPreviewStore((s) => s.previewMatches)
  const batchSubtitleIds = useAlignmentPreviewStore((s) => s.batchSubtitleIds)
  const debug = useAlignmentPreviewStore((s) => s.debug)
  const resetPreview = useAlignmentPreviewStore((s) => s.reset)
  const startLoading = useAlignmentPreviewStore((s) => s.startLoading)
  const setSuccess = useAlignmentPreviewStore((s) => s.setSuccess)
  const setRunError = useAlignmentPreviewStore((s) => s.setRunError)

  const subtitles = useSubtitleStore((s) => s.subtitles)
  const currentSubtitleId = useSubtitleStore((s) => s.currentSubtitleId)
  const segments = useScriptPoolStore((s) => s.segments)
  const applyPreview = useSubtitleStore((s) => s.applyDeepSeekPreviewMatches)
  const markSegUsed = useScriptPoolStore((s) => s.markSegmentsUsedForAlignment)

  const [debugOpen, setDebugOpen] = useState(false)

  const canRun =
    subtitles.length > 0 &&
    segments.some((s) => (s.language === 'english' || s.language === 'mixed') && s.text.trim().length > 0) &&
    phase !== 'loading'

  const runBatch = useCallback(async () => {
    const bridge = window.bilingualSubtitleAligner
    if (!bridge?.alignDeepSeekBatch) {
      window.alert('真实对齐仅在 Electron 桌面端可用（安全桥接未加载）。')
      return
    }
    const batch = pickAlignmentSubtitleBatch(subtitles, currentSubtitleId)
    if (batch.length === 0) {
      window.alert('没有可对齐的中文字幕。请先导入 SRT。')
      return
    }
    const startIdx = Math.max(0, subtitles.findIndex((l) => l.id === batch[0]!.id))
    const windowSegs = pickNearbyScriptSegments(segments, startIdx, subtitles.length)
    if (windowSegs.length === 0) {
      window.alert('Script Pool 中没有英文/混合片段。请先导入英文文稿。')
      return
    }

    const promptSubs = batch.map((l, i) => ({
      subtitleId: l.id,
      orderIndex: i + 1,
      chinese: l.chinese
    }))
    const promptSegs = windowSegs.map((s, i) => ({
      segmentId: s.id,
      orderIndex: i + 1,
      text: s.text,
      language: s.language
    }))
    const { messages } = buildAlignmentMessages(promptSubs, promptSegs)
    const est = estimatePromptTokens(messages.map((m) => m.content).join('\n'))

    startLoading(
      batch.map((b) => b.id),
      windowSegs.map((s) => s.id)
    )

    try {
      const result = await bridge.alignDeepSeekBatch({ model: settings.model, messages })
      if (!result.ok) {
        setRunError(result.error, {
          promptTokenEstimate: est,
          rawResponse: '',
          parseError: null,
          parsedJson: null,
          latencyMs: 0,
          usagePromptTokens: null
        })
        return
      }
      const usagePt = result.usage?.prompt_tokens ?? null
      const parsed = parseAlignmentModelJson(result.rawText)
      if (!parsed.ok) {
        setRunError(parsed.error, {
          promptTokenEstimate: est,
          rawResponse: result.rawText,
          parseError: parsed.error,
          parsedJson: null,
          latencyMs: result.latencyMs,
          usagePromptTokens: usagePt
        })
        return
      }
      setSuccess({
        matches: parsed.data.matches,
        batchSubtitleIds: batch.map((b) => b.id),
        segmentIdsInContext: windowSegs.map((s) => s.id),
        debug: {
          promptTokenEstimate: est,
          rawResponse: result.rawText,
          parseError: null,
          parsedJson: JSON.stringify(parsed.data, null, 2),
          latencyMs: result.latencyMs,
          usagePromptTokens: usagePt
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setRunError(msg, {
        promptTokenEstimate: est,
        rawResponse: '',
        parseError: null,
        parsedJson: null,
        latencyMs: 0,
        usagePromptTokens: null
      })
    }
  }, [subtitles, currentSubtitleId, segments, settings.model, startLoading, setSuccess, setRunError])

  const handleApply = useCallback(() => {
    if (!previewMatches || previewMatches.length === 0) return
    applyPreview(previewMatches)
    const ids = new Set<string>()
    for (const m of previewMatches) {
      for (const id of m.matchedSegmentIds) ids.add(id)
    }
    markSegUsed([...ids])
    resetPreview()
  }, [previewMatches, applyPreview, markSegUsed, resetPreview])

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
      <div>
        <h3 className="type-panel-title text-[13px] font-semibold">Real Alignment Sandbox</h3>
        <p className="type-caption mt-1 leading-snug text-secondary">
          使用 DeepSeek 对当前批次 <span className="text-primary font-medium">5</span> 条中文字幕与附近英文 Script Pool 片段做一次语义对齐（结果先预览，确认后再写入）。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="toolbar-btn text-[12px]" disabled={!canRun} onClick={() => void runBatch()}>
          {phase === 'loading' ? '对齐请求中…' : 'Run Real AI (5)'}
        </button>
        <button
          type="button"
          className="toolbar-btn text-[12px]"
          disabled={phase !== 'ready' || !previewMatches?.length}
          onClick={handleApply}
        >
          Apply AI Result
        </button>
        <button type="button" className="toolbar-btn text-[12px]" onClick={() => resetPreview()}>
          Clear preview
        </button>
      </div>

      {phase === 'loading' ? (
        <p className="type-caption text-[var(--color-text-secondary)]">正在请求 DeepSeek…</p>
      ) : null}

      {phase === 'error' && runError ? (
        <p className="type-caption text-red-600 dark:text-red-400">Failed: {runError}</p>
      ) : null}

      {phase === 'ready' && previewMatches && previewMatches.length > 0 ? (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2.5">
          <p className="type-field-label mb-2">Alignment Preview</p>
          <div className="max-h-48 space-y-2 overflow-y-auto text-[12px] leading-snug">
            {previewMatches.map((m, i) => (
              <div
                key={`${m.subtitleId}-${i}`}
                className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-2"
              >
                <p className="font-mono tabular-nums text-meta">#{String(m.subtitleId).padStart(3, '0')}</p>
                <p className="mt-1 text-primary">{m.english || '（空）'}</p>
                <p className="type-caption mt-1 text-secondary">
                  segments: {m.matchedSegmentIds.join(', ') || '—'} · conf{' '}
                  {Math.round(m.confidence <= 1 ? m.confidence * 100 : m.confidence)}%
                </p>
                <p className="type-caption mt-1 text-meta">{m.reason}</p>
              </div>
            ))}
          </div>
          <p className="type-caption mt-2 text-meta">批次字幕 id：{batchSubtitleIds.join(', ')}</p>
        </div>
      ) : phase === 'ready' && (!previewMatches || previewMatches.length === 0) ? (
        <p className="type-caption text-meta">模型返回了空 matches 列表。</p>
      ) : null}

      <div>
        <button
          type="button"
          className="type-caption font-medium text-[var(--color-text-secondary)] underline decoration-dotted"
          onClick={() => setDebugOpen((o) => !o)}
        >
          {debugOpen ? '隐藏' : '显示'} Debug panel
        </button>
        {debugOpen && (debug || phase === 'error') ? (
          <div className="mt-2 space-y-2 rounded-lg border border-dashed border-[var(--color-border-subtle)] p-2 font-mono text-[11px] leading-relaxed text-secondary">
            {debug ? (
              <>
                <p>prompt token estimate: {debug.promptTokenEstimate}</p>
                {debug.usagePromptTokens != null ? <p>usage.prompt_tokens (API): {debug.usagePromptTokens}</p> : null}
                <p>latency ms: {debug.latencyMs}</p>
                <p>
                  parse:{' '}
                  {debug.parseError ? <span className="text-red-500">{debug.parseError}</span> : <span>ok</span>}
                </p>
                <p className="text-meta">raw AI response ({debug.rawResponse.length} chars)</p>
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[10px]">
                  {debug.rawResponse || '—'}
                </pre>
                {debug.parsedJson ? (
                  <>
                    <p className="text-meta">parse result (normalized JSON)</p>
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[10px]">
                      {debug.parsedJson}
                    </pre>
                  </>
                ) : null}
              </>
            ) : (
              <p className="text-meta">无调试负载（仅错误消息）。</p>
            )}
          </div>
        ) : null}
        {debugOpen && phase !== 'error' && !debug ? <p className="type-caption mt-2 text-meta">尚无调试数据；请先运行一次对齐。</p> : null}
      </div>
    </div>
  )
}
