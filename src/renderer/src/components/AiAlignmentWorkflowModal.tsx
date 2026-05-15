import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent
} from 'react'
import {
  advanceEnglishCursor,
  computeSmallBatchAlignmentPlan,
  filterEnglishPoolSegments,
  validateAlignmentPrerequisites
} from '../lib/alignment'
import {
  isAlignmentSessionActive,
  useAlignmentSessionStore
} from '../store/alignmentSessionStore'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'
import { useScriptPoolStore } from '../store/scriptPoolStore'
import { useSubtitleStore } from '../store/subtitleStore'
import type { AiAlignmentRunConfig, SettingsState } from '../types'

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function parseSettingsInt(raw: string, min: number, max: number): number | null {
  if (raw === '' || raw === '-') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return clampInt(n, min, max)
}

export function AiAlignmentWorkflowModal({
  settings,
  onClose,
  onCommitAlignSettings,
  onStartAlignment
}: {
  settings: SettingsState
  onClose: () => void
  onCommitAlignSettings?: (patch: Partial<SettingsState>) => void
  /** 启动后台对齐；返回错误文案时调用方不应关闭 Modal。 */
  onStartAlignment: (config: AiAlignmentRunConfig) => string | null
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const currentSubtitleId = useSubtitleStore((s) => s.currentSubtitleId)
  const segments = useScriptPoolStore((s) => s.segments)
  const applyPreview = useSubtitleStore((s) => s.applyDeepSeekPreviewMatches)
  const markSegUsed = useScriptPoolStore((s) => s.markSegmentsUsedForAlignment)

  const phase = useAlignmentPreviewStore((s) => s.phase)
  const runError = useAlignmentPreviewStore((s) => s.runError)
  const previewMatches = useAlignmentPreviewStore((s) => s.previewMatches)
  const applyableMatches = useAlignmentPreviewStore((s) => s.applyableMatches)
  const batchSubtitleIds = useAlignmentPreviewStore((s) => s.batchSubtitleIds)
  const debug = useAlignmentPreviewStore((s) => s.debug)
  const lastReport = useAlignmentPreviewStore((s) => s.lastReport)
  const englishCursor = useAlignmentPreviewStore((s) => s.englishCursor)
  const setEnglishCursor = useAlignmentPreviewStore((s) => s.setEnglishCursor)
  const resetPreview = useAlignmentPreviewStore((s) => s.reset)

  const sessionStatus = useAlignmentSessionStore((s) => s.status)
  const sessionActive = isAlignmentSessionActive(sessionStatus)
  const sessionSummary = useAlignmentSessionStore((s) => s.lastSummary)
  const sessionError = useAlignmentSessionStore((s) => s.lastError)
  const activeConfig = useAlignmentSessionStore((s) => s.activeConfig)
  const finalReport = useAlignmentSessionStore((s) => s.finalReport)
  const sessionMode = useAlignmentSessionStore((s) => s.mode)

  const [draft, setDraft] = useState<AiAlignmentRunConfig>(() => ({
    model: settings.model,
    batchSize: settings.batchSize,
    confidenceThreshold: settings.confidenceThreshold,
    mode: 'full_file'
  }))

  const [promptOpen, setPromptOpen] = useState(false)
  const [groupsOpen, setGroupsOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [connPhase, setConnPhase] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [connMsg, setConnMsg] = useState('')

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  useEffect(() => {
    if (sessionActive && activeConfig) {
      setDraft(activeConfig)
      return
    }
    setDraft((d) => ({
      ...d,
      model: settings.model,
      batchSize: settings.batchSize,
      confidenceThreshold: settings.confidenceThreshold,
      mode: 'full_file'
    }))
  }, [settings.model, settings.batchSize, settings.confidenceThreshold, sessionActive, activeConfig])

  function patchDraft(patch: Partial<AiAlignmentRunConfig>): void {
    setDraft((d) => ({ ...d, ...patch }))
  }

  const plan = useMemo(
    () =>
      computeSmallBatchAlignmentPlan({
        subtitles,
        currentSubtitleId,
        segments,
        englishCursor,
        batchSize: draft.batchSize
      }),
    [subtitles, currentSubtitleId, segments, englishCursor, draft.batchSize]
  )

  const engPoolSize = filterEnglishPoolSegments(segments).length
  const bridge = typeof window !== 'undefined' ? window.bilingualSubtitleAligner : undefined
  const aiReady = Boolean(bridge?.alignDeepSeekBatch)
  const prereqError = validateAlignmentPrerequisites({
    apiKey: settings.apiKey,
    subtitleCount: subtitles.length,
    englishPoolSize: engPoolSize,
    bridgeReady: aiReady
  })

  const commitDraftToSettings = useCallback(() => {
    onCommitAlignSettings?.({
      model: draft.model,
      batchSize: draft.batchSize,
      confidenceThreshold: draft.confidenceThreshold
    })
  }, [draft, onCommitAlignSettings])

  const handleRunFullFile = useCallback(() => {
    if (sessionActive) return
    commitDraftToSettings()
    const err = onStartAlignment({ ...draft, mode: 'full_file' })
    if (err) {
      window.alert(err)
      return
    }
    onClose()
  }, [sessionActive, draft, commitDraftToSettings, onStartAlignment, onClose])

  const handleRunBatchTest = useCallback(() => {
    if (sessionActive) return
    commitDraftToSettings()
    const err = onStartAlignment({ ...draft, mode: 'batch_test' })
    if (err) window.alert(err)
  }, [sessionActive, draft, commitDraftToSettings, onStartAlignment])

  const handleApply = useCallback(() => {
    const state = useAlignmentPreviewStore.getState()
    const applyable = state.applyableMatches
    const groups = state.lastCandidateGroups
    if (!applyable?.length) {
      window.alert('当前没有可应用的结果。')
      return
    }
    applyPreview(applyable)
    const ids = new Set<string>()
    for (const m of applyable) {
      for (const id of m.matchedSegmentIds) ids.add(id)
    }
    markSegUsed([...ids])
    const engPool = filterEnglishPoolSegments(useScriptPoolStore.getState().segments)
    setEnglishCursor(
      advanceEnglishCursor({
        previousCursor: state.englishCursor,
        acceptedMatches: applyable,
        candidateGroups: groups,
        poolLength: engPool.length
      })
    )
    resetPreview()
  }, [applyPreview, markSegUsed, setEnglishCursor, resetPreview])

  const testConnection = useCallback(async () => {
    const b = window.bilingualSubtitleAligner
    if (!b?.testDeepSeekConnection) {
      setConnPhase('fail')
      setConnMsg('桥接未加载')
      return
    }
    setConnPhase('testing')
    setConnMsg('')
    try {
      const r = await b.testDeepSeekConnection(settings.apiKey, draft.model)
      if (r.ok) {
        setConnPhase('ok')
        setConnMsg('连接正常')
      } else {
        setConnPhase('fail')
        setConnMsg(r.error ?? '失败')
      }
    } catch (e) {
      setConnPhase('fail')
      setConnMsg(e instanceof Error ? e.message : String(e))
    }
  }, [settings.apiKey, draft.model])

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose()
  }

  const applyableCount = applyableMatches?.length ?? 0
  const displayMatches = previewMatches ?? []
  const previewReady = phase === 'ready'
  const hasApplyableDebugResult =
    previewReady && applyableCount > 0 && !sessionActive && sessionMode !== 'full_file'

  const canRunFullFile = !sessionActive && !prereqError && subtitles.length > 0
  const canRunBatchTest =
    !sessionActive &&
    !prereqError &&
    Boolean(plan) &&
    (plan?.candidateGroups.length ?? 0) > 0

  const showRunFullAgain =
    !sessionActive &&
    (sessionStatus === 'completed' || sessionStatus === 'failed') &&
    (sessionMode === 'full_file' || sessionMode === null)

  const totalBatchesEstimate = Math.max(1, Math.ceil(subtitles.length / draft.batchSize))

  const promptSummary =
    plan != null
      ? `system + user JSON · 约 ${plan.promptCharCount} 字符`
      : '（无可用计划：请检查字幕与纯英文池）'

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        className="modal-dialog modal-dialog--ai-alignment"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-alignment-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header shrink-0">
          <h2
            id="ai-alignment-title"
            className="min-w-0 flex-1 truncate text-left text-[16px] font-semibold tracking-tight text-primary"
          >
            AI 整文件对齐
          </h2>
          <button
            type="button"
            className="text-meta shrink-0 rounded-lg px-2 text-2xl leading-none hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="modal-body-scroll min-h-0 flex-1 overflow-y-auto">
          <div className="modal-section-stack">
            <p className="text-secondary text-[13px] leading-snug">
              导入中文 SRT 与英文原稿后，点击「运行整文件 AI 对齐」即可自动顺序处理全部字幕并写入结果。进度在右侧
              Alignment Panel 实时查看。
            </p>

            {sessionActive ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
                <p className="font-semibold">整文件对齐进行中</p>
                <p className="mt-1 text-meta">{sessionSummary}</p>
                <p className="mt-1 text-meta">可关闭本窗口；右侧 Panel 将持续更新。</p>
              </div>
            ) : sessionStatus === 'completed' || sessionStatus === 'failed' ? (
              <div
                className={`rounded-lg border px-3 py-2 text-[12px] ${
                  sessionStatus === 'failed'
                    ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                }`}
              >
                <p className="font-semibold">
                  {sessionStatus === 'failed' ? '上次整文件任务失败' : '上次整文件任务已完成'}
                </p>
                <p className="mt-1">{sessionSummary}</p>
                {sessionError ? <p className="mt-1 text-meta">{sessionError}</p> : null}
              </div>
            ) : null}

            <section className="settings-section">
              <h3 className="settings-heading">对齐参数</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="settings-label">
                  Model
                  <select
                    className="settings-select mt-1 w-full"
                    value={draft.model}
                    disabled={sessionActive}
                    onChange={(e) => patchDraft({ model: e.currentTarget.value })}
                  >
                    <option value="deepseek-chat">deepseek-chat</option>
                    <option value="deepseek-reasoner">deepseek-reasoner</option>
                  </select>
                </label>
                <label className="settings-label">
                  Batch Size（每批字幕条数）
                  <input
                    type="number"
                    className="settings-input mt-1 w-full"
                    min={1}
                    max={50}
                    step={1}
                    value={draft.batchSize}
                    disabled={sessionActive}
                    onChange={(e) => {
                      const next = parseSettingsInt(e.currentTarget.value, 1, 50)
                      if (next === null) return
                      patchDraft({ batchSize: next })
                    }}
                  />
                </label>
                <label className="settings-label sm:col-span-2">
                  Confidence Threshold（%）
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <input
                      type="number"
                      className="settings-input min-w-0 flex-1"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.confidenceThreshold}
                      disabled={sessionActive}
                      onChange={(e) => {
                        const next = parseSettingsInt(e.currentTarget.value, 0, 100)
                        if (next === null) return
                        patchDraft({ confidenceThreshold: next })
                      }}
                    />
                    <span className="text-meta shrink-0 text-[13px]">%</span>
                  </div>
                </label>
              </div>
              <div className="mt-3 grid gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-3 text-[12px]">
                <p>
                  <span className="text-meta">预计批次数 · </span>
                  {subtitles.length > 0 ? totalBatchesEstimate : '—'}
                </p>
                <p>
                  <span className="text-meta">字幕总数 · </span>
                  {subtitles.length}
                </p>
                <p className="text-meta">
                  AI Ready: {aiReady ? '是' : '否'} · 纯英文池 {engPoolSize} 段
                </p>
                {prereqError ? (
                  <p className="type-caption mt-2 text-amber-700 dark:text-amber-300">{prereqError}</p>
                ) : null}
              </div>
            </section>

            <section className="settings-section">
              <h3 className="settings-heading">连接</h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="toolbar-btn text-[12px]"
                  disabled={connPhase === 'testing' || sessionActive}
                  onClick={() => void testConnection()}
                >
                  {connPhase === 'testing' ? '测试中…' : 'Test Connection'}
                </button>
                {connPhase === 'ok' ? <span className="type-caption text-emerald-600">{connMsg}</span> : null}
                {connPhase === 'fail' ? <span className="type-caption text-red-500">{connMsg}</span> : null}
              </div>
            </section>

            <section className="settings-section">
              <h3 className="settings-heading">Alignment Report</h3>
              {finalReport ? (
                <ul className="type-caption space-y-1 text-secondary">
                  <li>字幕总数: {finalReport.totalSubtitleCount}</li>
                  <li>已匹配（有英文）: {finalReport.matchedSubtitleCount}</li>
                  <li>需复查: {finalReport.needsReviewCount}</li>
                  <li>未匹配: {finalReport.unmatchedCount}</li>
                  <li>低置信度: {finalReport.lowConfidenceCount}</li>
                  <li>未使用英文段: {finalReport.unusedEnglishSegmentIds.length}</li>
                  <li>重复 segment: {finalReport.duplicateSegmentIds.length}</li>
                </ul>
              ) : sessionStatus === 'running' ? (
                <p className="type-caption text-meta">整文件对齐完成后自动生成报告。</p>
              ) : lastReport && sessionMode === 'batch_test' ? (
                <ul className="type-caption space-y-1 text-secondary">
                  <li className="text-meta">（调试小批 · 非整文件报告）</li>
                  <li>本批字幕: {lastReport.batchSubtitleCount}</li>
                  <li>可应用: {lastReport.matchedSubtitleCount}</li>
                  <li>低置信度: {lastReport.lowConfidenceCount}</li>
                  <li>需复查: {lastReport.needsReviewCount}</li>
                  <li>顺序补齐: {lastReport.sequentialFallbackCount}</li>
                  {lastReport.alignmentDrift ? (
                    <li className="text-amber-700 dark:text-amber-300">
                      alignment drift: {lastReport.alignmentDriftReasons.join(' · ')}
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="type-caption text-meta">完成整文件对齐后在此显示汇总报告。</p>
              )}
            </section>

            <details
              className="settings-section rounded-lg border border-[var(--color-border-subtle)] p-3"
              open={debugOpen}
              onToggle={(e) => setDebugOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="settings-heading cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                Developer / Debug · 当前小批测试
              </summary>
              <p className="type-caption mt-2 text-meta leading-snug">
                仅用于 prompt、候选组与校验调试。预览结果需手动「应用」；不会作为正式整文件流程。
              </p>

              <div className="mt-3 grid gap-2 rounded-lg border border-dashed border-[var(--color-border-subtle)] p-3 text-[12px]">
                <p>
                  <span className="text-meta">Current batch range · </span>
                  {plan ? plan.subtitleRangeLabel : '—'}
                </p>
                <p>
                  <span className="text-meta">English window · </span>
                  {plan ? plan.englishWindowLabel : '—'}
                </p>
                <label className="settings-label mt-1">
                  English cursor（调试用手动游标）
                  <input
                    type="number"
                    className="settings-input mt-1 w-full font-mono tabular-nums"
                    min={0}
                    value={englishCursor}
                    disabled={sessionActive}
                    onChange={(e) => {
                      const v = parseSettingsInt(e.currentTarget.value, 0, Math.max(0, engPoolSize))
                      if (v === null) return
                      setEnglishCursor(v)
                    }}
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="toolbar-btn text-[12px]"
                  disabled={!canRunBatchTest || sessionActive}
                  onClick={handleRunBatchTest}
                >
                  运行当前小批测试
                </button>
                {hasApplyableDebugResult ? (
                  <button
                    type="button"
                    className="toolbar-btn toolbar-btn--primary-action text-[12px]"
                    onClick={handleApply}
                  >
                    应用调试结果 ({applyableCount})
                  </button>
                ) : null}
                {phase === 'ready' || phase === 'error' ? (
                  <button
                    type="button"
                    className="type-caption text-meta underline decoration-dotted"
                    disabled={sessionActive}
                    onClick={() => resetPreview()}
                  >
                    清除预览
                  </button>
                ) : null}
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="type-field-label m-0">Candidate Groups</p>
                  <button
                    type="button"
                    className="type-caption text-meta underline decoration-dotted"
                    onClick={() => setGroupsOpen((o) => !o)}
                  >
                    {groupsOpen ? '折叠' : '展开'}
                  </button>
                </div>
                {groupsOpen && plan ? (
                  <div className="mt-2 max-h-40 overflow-auto rounded border border-[var(--color-border-subtle)] font-mono text-[11px]">
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-[var(--color-bg-panel)]">
                        <tr className="border-b border-[var(--color-border-subtle)]">
                          <th className="p-1.5">groupId</th>
                          <th className="p-1.5">segs</th>
                          <th className="p-1.5">text</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.candidateGroups.map((g) => (
                          <tr key={g.id} className="border-b border-[var(--color-border-subtle)] align-top">
                            <td className="p-1.5 whitespace-nowrap text-meta">{g.id}</td>
                            <td className="p-1.5 text-meta">{g.segmentIds.length}</td>
                            <td className="p-1.5 leading-snug">
                              {g.text.slice(0, 80)}
                              {g.text.length > 80 ? '…' : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="type-field-label m-0">Prompt Preview</p>
                  <button
                    type="button"
                    className="type-caption text-meta underline decoration-dotted"
                    onClick={() => setPromptOpen((o) => !o)}
                  >
                    {promptOpen ? '折叠' : '展开'}
                  </button>
                </div>
                <p className="type-caption mt-1 text-secondary">{promptSummary}</p>
                {promptOpen && plan ? (
                  <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-2 text-[10px] leading-relaxed">
                    {plan.promptUserPayloadPreview}
                  </pre>
                ) : null}
              </div>

              <div className="mt-4">
                <p className="type-field-label">Result / Debug</p>
                {phase === 'error' && runError ? (
                  <p className="type-caption text-red-600">{runError}</p>
                ) : null}
                {debug ? (
                  <div className="mt-2 space-y-2 font-mono text-[11px] text-secondary">
                    <p className="text-meta">latency: {debug.latencyMs} ms</p>
                    {debug.validationWarnings.length > 0 ? (
                      <ul className="list-inside list-disc text-amber-800 dark:text-amber-200">
                        {debug.validationWarnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-bg-base)] p-2 text-[10px]">
                      {debug.rawResponse || '—'}
                    </pre>
                  </div>
                ) : phase === 'ready' && displayMatches.length > 0 ? (
                  <div className="mt-2 max-h-36 space-y-2 overflow-y-auto text-[12px]">
                    {displayMatches.map((m, i) => (
                      <div
                        key={`${m.subtitleId}-${i}`}
                        className={`rounded border p-2 ${
                          m.applyable ? 'border-[var(--color-border-subtle)]' : 'border-red-500/40'
                        }`}
                      >
                        <p className="font-mono text-meta">#{m.subtitleId}</p>
                        <p className="mt-1">{m.english || '（空）'}</p>
                      </div>
                    ))}
                    <p className="type-caption text-meta">batch ids: {batchSubtitleIds.join(', ')}</p>
                  </div>
                ) : (
                  <p className="type-caption mt-1 text-meta">运行小批测试后显示。</p>
                )}
              </div>
            </details>
          </div>
        </div>

        <footer className="ai-alignment-sticky-footer" role="toolbar" aria-label="对齐工作流操作">
          <button
            type="button"
            className="settings-footer-button btn-secondary-solid"
            onClick={onClose}
          >
            关闭
          </button>
          {showRunFullAgain ? (
            <button
              type="button"
              className="settings-footer-button btn-accent-ghost"
              disabled={!canRunFullFile}
              onClick={handleRunFullFile}
            >
              再次运行整文件对齐
            </button>
          ) : null}
          {!sessionActive && !showRunFullAgain ? (
            <button
              type="button"
              className="settings-footer-button btn-accent-solid"
              disabled={!canRunFullFile}
              onClick={handleRunFullFile}
            >
              运行整文件 AI 对齐
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  )
}
