import { useCallback, useEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import { AlignmentReviewPanel } from './AlignmentReviewPanel'
import { filterEnglishPoolSegments, validateAlignmentPrerequisites } from '../lib/alignment'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'
import {
  isAlignmentSessionActive,
  useAlignmentSessionStore
} from '../store/alignmentSessionStore'
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
  const segments = useScriptPoolStore((s) => s.segments)

  const sessionStatus = useAlignmentSessionStore((s) => s.status)
  const sessionActive = isAlignmentSessionActive(sessionStatus)
  const previewPhase = useAlignmentPreviewStore((s) => s.phase)
  const sessionSummary = useAlignmentSessionStore((s) => s.lastSummary)
  const sessionError = useAlignmentSessionStore((s) => s.lastError)
  const activeConfig = useAlignmentSessionStore((s) => s.activeConfig)
  const finalReport = useAlignmentSessionStore((s) => s.finalReport)

  const [draft, setDraft] = useState<AiAlignmentRunConfig>(() => ({
    model: settings.model,
    batchSize: settings.batchSize,
    confidenceThreshold: settings.confidenceThreshold
  }))

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
      confidenceThreshold: settings.confidenceThreshold
    }))
  }, [settings.model, settings.batchSize, settings.confidenceThreshold, sessionActive, activeConfig])

  function patchDraft(patch: Partial<AiAlignmentRunConfig>): void {
    setDraft((d) => ({ ...d, ...patch }))
  }

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
    const err = onStartAlignment({ ...draft })
    if (err) {
      window.alert(err)
      return
    }
    onClose()
  }, [sessionActive, draft, commitDraftToSettings, onStartAlignment, onClose])

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

  const canRunFullFile = !sessionActive && !prereqError && subtitles.length > 0

  const showRunFullAgain =
    !sessionActive &&
    (sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'stopped')

  const totalBatchesEstimate = Math.max(1, Math.ceil(subtitles.length / draft.batchSize))

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
            ) : sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'stopped' ? (
              <div
                className={`rounded-lg border px-3 py-2 text-[12px] ${
                  sessionStatus === 'failed'
                    ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                    : sessionStatus === 'stopped'
                      ? 'border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-secondary'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                }`}
              >
                <p className="font-semibold">
                  {sessionStatus === 'failed'
                    ? '上次整文件任务失败'
                    : sessionStatus === 'stopped'
                      ? '上次整文件任务已停止'
                      : '上次整文件任务已完成'}
                </p>
                <p className="mt-1">{sessionSummary}</p>
                {sessionError ? <p className="mt-1 text-meta">{sessionError}</p> : null}
              </div>
            ) : null}

            {sessionActive && previewPhase === 'ready' ? <AlignmentReviewPanel compact /> : null}

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
              ) : (
                <p className="type-caption text-meta">完成整文件对齐后在此显示汇总报告。</p>
              )}
            </section>

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
