import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { mockSubtitles } from './mocks/subtitles'
import type {
  AlignmentSession,
  AlignmentWorkflowDraft,
  SettingsState,
  SubtitleLine,
  SubtitleStatus
} from './types'

const statusMeta: Record<
  SubtitleStatus,
  {
    label: string
    badgeClass: string
    dotClass: string
  }
> = {
  confirmed: {
    label: 'Confirmed',
    badgeClass: 'status-badge status-badge--confirmed',
    dotClass: 'status-dot status-dot--confirmed'
  },
  lowConfidence: {
    label: 'Low Confidence',
    badgeClass: 'status-badge status-badge--low',
    dotClass: 'status-dot status-dot--low'
  },
  manuallyEdited: {
    label: 'Manually Edited',
    badgeClass: 'status-badge status-badge--edited',
    dotClass: 'status-dot status-dot--edited'
  },
  unmatched: {
    label: 'Unmatched',
    badgeClass: 'status-badge status-badge--unmatched',
    dotClass: 'status-dot status-dot--unmatched'
  }
}

const THEME_STORAGE_KEY = 'subtitle-aligner-theme'

function readStoredTheme(): 'light' | 'dark' {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

const defaultSettings: SettingsState = {
  provider: 'Deepseek',
  apiKey: '',
  model: '可选模型',
  batchSize: 20,
  confidenceThreshold: 70,
  autoMarkHighConfidence: true,
  subtitleOrder: 'chineseFirst',
  exportFormat: '.srt',
  separateLines: true,
  theme: 'dark',
  fontSize: 14
}

function createIdleAlignmentSession(total: number): AlignmentSession {
  return {
    phase: 'idle',
    progressPct: 0,
    batchIndex: 0,
    batchTotal: 0,
    matched: 0,
    total,
    batchSize: defaultSettings.batchSize
  }
}

function alignmentStateLabel(phase: AlignmentSession['phase']): string {
  if (phase === 'idle') return 'Ready'
  if (phase === 'aligning') return 'Aligning'
  return 'Complete'
}

function subtitlesInCurrentBatch(session: AlignmentSession): number {
  if (session.phase === 'idle' || session.batchTotal === 0 || session.batchIndex < 1) return 0
  return Math.min(session.batchSize, session.total - (session.batchIndex - 1) * session.batchSize)
}

function estimateApiUsageTokens(draft: AlignmentWorkflowDraft, subtitleCount: number): number {
  const batches = Math.max(1, Math.ceil(subtitleCount / draft.batchSize))
  return Math.round(batches * draft.batchSize * 220)
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')};${String(millis).padStart(3, '0')}`
}

function compactTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function shortText(text: string, length = 42): string {
  return text.length > length ? `${text.slice(0, length)}...` : text
}

function App(): JSX.Element {
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>(mockSubtitles)
  const [selectedId, setSelectedId] = useState('sub-003')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<SettingsState>(() => ({
    ...defaultSettings,
    theme: readStoredTheme()
  }))
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(7100)
  const [alignmentModalOpen, setAlignmentModalOpen] = useState(false)
  const [alignmentSession, setAlignmentSession] = useState<AlignmentSession>(() => createIdleAlignmentSession(mockSubtitles.length))
  const durationMs = subtitles[subtitles.length - 1]?.endMs ?? 1

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, settings.theme)
    } catch {
      /* ignore */
    }
  }, [settings.theme])

  useEffect(() => {
    setAlignmentSession((prev) => (prev.phase === 'idle' ? { ...prev, total: subtitles.length } : prev))
  }, [subtitles.length])

  useEffect(() => {
    if (alignmentSession.phase !== 'aligning') return
    const interval = window.setInterval(() => {
      setAlignmentSession((prev) => {
        if (prev.phase !== 'aligning') return prev
        const step = 1.6 + Math.random() * 1.8
        const nextProgress = Math.min(100, prev.progressPct + step)
        const ratio = nextProgress / 100
        const matched =
          nextProgress >= 100 ? prev.total : Math.min(prev.total, Math.floor(ratio * prev.total * 0.96))
        const batchIndex =
          nextProgress >= 100
            ? prev.batchTotal
            : Math.min(prev.batchTotal, Math.max(1, Math.ceil(ratio * prev.batchTotal)))
        if (nextProgress >= 100) {
          return {
            ...prev,
            phase: 'complete',
            progressPct: 100,
            matched: prev.total,
            batchIndex: prev.batchTotal
          }
        }
        return { ...prev, progressPct: nextProgress, matched, batchIndex }
      })
    }, 300)
    return () => window.clearInterval(interval)
  }, [alignmentSession.phase])

  const selected = subtitles.find((subtitle) => subtitle.id === selectedId) ?? subtitles[0]
  const activeSubtitle = subtitles.find((subtitle) => currentTimeMs >= subtitle.startMs && currentTimeMs <= subtitle.endMs)
  const activeId = activeSubtitle?.id

  useEffect(() => {
    if (!isPlaying) return

    const interval = window.setInterval(() => {
      setCurrentTimeMs((current) => {
        const next = current + 100
        return next > durationMs ? 0 : next
      })
    }, 100)

    return () => window.clearInterval(interval)
  }, [durationMs, isPlaying])

  useEffect(() => {
    if (activeId) setSelectedId(activeId)
  }, [activeId])

  function updateSubtitle(id: string, patch: Partial<SubtitleLine>): void {
    setSubtitles((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function applyCandidate(candidate: string): void {
    updateSubtitle(selected.id, {
      en: candidate,
      status: selected.status === 'unmatched' ? 'manuallyEdited' : selected.status
    })
  }

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
  }, [])

  const openAlignmentModal = useCallback(() => {
    setAlignmentModalOpen(true)
  }, [])

  const closeAlignmentModal = useCallback(() => {
    setAlignmentModalOpen(false)
  }, [])

  const runAlignmentFromWorkflow = useCallback((draft: AlignmentWorkflowDraft) => {
    setSettings((s) => ({
      ...s,
      model: draft.model,
      batchSize: draft.batchSize,
      confidenceThreshold: draft.confidenceThreshold
    }))
    const total = subtitles.length
    const batchTotal = Math.max(1, Math.ceil(total / draft.batchSize))
    setAlignmentSession({
      phase: 'aligning',
      progressPct: 0,
      batchIndex: 1,
      batchTotal,
      matched: 0,
      total,
      batchSize: draft.batchSize
    })
    setAlignmentModalOpen(false)
  }, [subtitles.length])

  return (
    <>
      <main className="app-root app-workbench relative flex h-screen min-h-0 flex-col overflow-hidden font-sans text-[13px] leading-normal antialiased">
        <TopBar
          alignmentBatchIndex={alignmentSession.batchIndex}
          alignmentBatchTotal={alignmentSession.batchTotal}
          alignmentMatched={alignmentSession.matched}
          alignmentPhase={alignmentSession.phase}
          alignmentTotal={alignmentSession.total}
          settingsOpen={settingsOpen}
          onOpenAlignment={openAlignmentModal}
          onOpenSettings={openSettings}
        />

        <section className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(8.25rem,0.27fr)_minmax(0,1fr)_minmax(7rem,0.23fr)] gap-5">
          <SubtitleNavigator
            activeId={activeId}
            selectedId={selected.id}
            subtitles={subtitles}
            onSelect={(id) => {
              setSelectedId(id)
              const line = subtitles.find((item) => item.id === id)
              if (line) setCurrentTimeMs(line.startMs)
            }}
          />

          <AlignmentWorkspace
            selected={selected}
            onCandidateClick={applyCandidate}
            onChineseChange={(zh) => updateSubtitle(selected.id, { zh, status: 'manuallyEdited' })}
            onEnglishChange={(en) => updateSubtitle(selected.id, { en, status: 'manuallyEdited' })}
          />

          <AlignmentStatus session={alignmentSession} settings={settings} />
        </section>

        <TimelineSimulator
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          isPlaying={isPlaying}
          selected={selected}
          onPlayToggle={() => setIsPlaying((playing) => !playing)}
          onStop={() => {
            setIsPlaying(false)
            setCurrentTimeMs(0)
          }}
          onSeek={setCurrentTimeMs}
        />
      </main>

      {alignmentModalOpen
        ? createPortal(
            <AlignmentWorkflowModal
              subtitleCount={subtitles.length}
              settings={settings}
              onClose={closeAlignmentModal}
              onRun={runAlignmentFromWorkflow}
            />,
            document.body
          )
        : null}

      {settingsOpen
        ? createPortal(
            <SettingsModal settings={settings} onChange={setSettings} onClose={closeSettings} />,
            document.body
          )
        : null}
    </>
  )
}

function TopBar({
  settingsOpen,
  onOpenSettings,
  onOpenAlignment,
  alignmentPhase,
  alignmentBatchIndex,
  alignmentBatchTotal,
  alignmentMatched,
  alignmentTotal
}: {
  settingsOpen: boolean
  onOpenSettings: () => void
  onOpenAlignment: () => void
  alignmentPhase: AlignmentSession['phase']
  alignmentBatchIndex: number
  alignmentBatchTotal: number
  alignmentMatched: number
  alignmentTotal: number
}): JSX.Element {
  const aligning = alignmentPhase === 'aligning'
  const showLiveMeta = alignmentPhase === 'aligning' || alignmentPhase === 'complete'

  return (
    <header className="app-toolbar">
      <div className="app-toolbar__strip" role="toolbar" aria-label="主工具栏">
        <button
          type="button"
          className="toolbar-btn toolbar-btn--primary-action"
          disabled={aligning}
          onClick={onOpenAlignment}
        >
          Start AI Alignment
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button type="button" className="toolbar-btn">
          导入中文 SRT
        </button>
        <button type="button" className="toolbar-btn">
          导入英文文稿
        </button>
        <button type="button" className="toolbar-btn">
          导出
        </button>
        <button
          type="button"
          className={`toolbar-btn${settingsOpen ? ' toolbar-btn--active' : ''}`}
          onClick={onOpenSettings}
        >
          设置
        </button>
        <span className="toolbar-sep" aria-hidden />
        <button type="button" className="toolbar-btn toolbar-btn--icon" aria-label="撤销">
          <span className="toolbar-btn__glyph" aria-hidden>
            ↶
          </span>
        </button>
        <button type="button" className="toolbar-btn toolbar-btn--icon" aria-label="重做">
          <span className="toolbar-btn__glyph" aria-hidden>
            ↷
          </span>
        </button>
      </div>

      <div className="app-toolbar__meta type-toolbar-meta hidden text-right sm:block">
        {showLiveMeta ? (
          <>
            <p className="text-primary font-semibold tabular-nums">
              Batch {alignmentBatchIndex} / {alignmentBatchTotal}
            </p>
            <p className="text-secondary mt-0.5 leading-tight tabular-nums">
              {alignmentMatched} / {alignmentTotal} matched
            </p>
          </>
        ) : (
          <>
            <p className="text-primary font-semibold">AI alignment</p>
            <p className="text-secondary mt-0.5 leading-tight">Run from toolbar to begin</p>
          </>
        )}
      </div>
    </header>
  )
}

function SubtitleNavigator({
  activeId,
  selectedId,
  subtitles,
  onSelect
}: {
  activeId?: string
  selectedId: string
  subtitles: SubtitleLine[]
  onSelect: (id: string) => void
}): JSX.Element {
  return (
    <aside className="app-panel app-panel--sidebar flex min-h-0 min-w-0 flex-col">
      <div className="app-panel-header nav-panel-head px-3 py-2">
        <h2 className="ui-section-title">Subtitles</h2>
        <p className="type-caption mt-0.5">{subtitles.length} lines</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2">
        {subtitles.map((subtitle) => {
          const meta = statusMeta[subtitle.status]
          const selected = subtitle.id === selectedId
          const active = subtitle.id === activeId

          return (
            <button
              key={subtitle.id}
              type="button"
              className={`subtitle-list-item${selected ? ' subtitle-list-item-selected' : ''}`}
              onClick={() => onSelect(subtitle.id)}
            >
              <span className={meta.dotClass} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="type-nav-id tabular-nums">#{String(subtitle.index).padStart(3, '0')}</span>
                  <span className="type-nav-time font-mono tabular-nums">{compactTime(subtitle.startMs)}</span>
                </span>
                <span className="type-nav-preview mt-0.5 block truncate text-left leading-snug">
                  {subtitle.zh ? shortText(subtitle.zh, 34) : '需要匹配'}
                </span>
                <span className={`${meta.badgeClass} nav-badge-offset`}>{meta.label}</span>
              </span>
              {active && <span className="subtitle-list-item-active-dot absolute right-2 top-2 h-1.5 w-1.5 rounded-full" />}
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function AlignmentWorkspace({
  selected,
  onCandidateClick,
  onChineseChange,
  onEnglishChange
}: {
  selected: SubtitleLine
  onCandidateClick: (candidate: string) => void
  onChineseChange: (value: string) => void
  onEnglishChange: (value: string) => void
}): JSX.Element {
  const meta = statusMeta[selected.status]

  return (
    <section className="app-panel app-panel--primary flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="app-panel-header workspace-head shrink-0 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div>
            <p className="type-field-label">Current Subtitle</p>
            <h1 className="type-workspace-id mt-1">#{String(selected.index).padStart(3, '0')}</h1>
            <p className="type-workspace-time mt-1 font-mono tabular-nums">
              {formatTime(selected.startMs)} → {formatTime(selected.endMs)}
            </p>
          </div>
          <span className={meta.badgeClass}>{meta.label}</span>
        </div>
      </div>

      <div className="workspace-body grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">
        <label className="block">
          <span className="type-field-label mb-1.5 block">Chinese Subtitle</span>
          <textarea
            className="subtitle-editor subtitle-editor--dense"
            value={selected.zh}
            onChange={(event) => onChineseChange(event.currentTarget.value)}
          />
        </label>

        <label className="block">
          <span className="type-field-label mb-1.5 block">English Subtitle</span>
          <textarea
            className="subtitle-editor subtitle-editor--dense"
            value={selected.en}
            onChange={(event) => onEnglishChange(event.currentTarget.value)}
          />
        </label>

        <div className="candidate-well">
          <div className="candidate-well__head mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div>
              <h2 className="type-panel-title">AI Candidate Matches</h2>
              <p className="type-caption mt-0.5">Line confidence {selected.confidence}%</p>
            </div>
            <div className="confidence-track confidence-track--compact w-24">
              <div className="confidence-fill" style={{ width: `${selected.confidence}%` }} />
            </div>
          </div>

          <div className="candidate-stack">
            {selected.candidates.map((candidate, index) => {
              const confidence = [72, 58, 31][index] ?? Math.max(20, selected.confidence - index * 12)
              const isActive = candidate === selected.en

              return (
                <button
                  key={candidate}
                  type="button"
                  className={`candidate-card${isActive ? ' candidate-card--selected' : ''}`}
                  onClick={() => onCandidateClick(candidate)}
                >
                  <span className="candidate-score">{confidence}%</span>
                  <span className="type-candidate-text min-w-0 flex-1 text-left">{candidate}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function AlignmentStatus({ settings, session }: { settings: SettingsState; session: AlignmentSession }): JSX.Element {
  const progressPct = session.phase === 'idle' ? 0 : Math.round(session.progressPct)
  const matchedLine = `${session.matched} / ${session.total}`
  const inBatch = subtitlesInCurrentBatch(session)

  return (
    <aside className="app-panel alignment-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="app-panel-header alignment-panel__head shrink-0 px-3 py-2.5">
        <h2 className="ui-section-title">Alignment</h2>
        <p className="type-caption alignment-monitor-tag mt-1">AI session monitor</p>
        <p className="type-caption mt-1 leading-snug">
          {settings.provider} · <span className="text-secondary">{settings.model}</span>
        </p>
      </div>

      <div className="alignment-panel__body min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="type-field-label">Run progress</span>
            <span className="type-run-pct tabular-nums">{progressPct}%</span>
          </div>
          <div className="alignment-progress-track">
            <div className="alignment-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div>
          <p className="type-field-label mb-1">Current batch</p>
          <p className="type-panel-stat tabular-nums">
            {session.phase === 'idle' || session.batchTotal === 0 ? (
              '—'
            ) : (
              <>
                {session.batchIndex} <span className="type-caption font-medium">/</span> {session.batchTotal}
              </>
            )}
          </p>
          <p className="type-caption mt-1">
            {session.phase === 'idle' || session.batchTotal === 0
              ? 'No active batch'
              : `${inBatch} subtitle${inBatch === 1 ? '' : 's'} in this batch`}
          </p>
        </div>

        <div className="metric-stack space-y-3">
          <Metric label="Matched" value={matchedLine} />
          <Metric label="State" value={alignmentStateLabel(session.phase)} />
        </div>
      </div>
    </aside>
  )
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric-card">
      <p className="type-field-label mb-1">{label}</p>
      <p className="type-panel-stat tabular-nums">{value}</p>
    </div>
  )
}

function PauseGlyph(): JSX.Element {
  return (
    <svg className="transport-tower__pause-icon" viewBox="0 0 24 24" width={18} height={18} aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1.25" ry="1.25" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1.25" ry="1.25" fill="currentColor" />
    </svg>
  )
}

function TimelineSimulator({
  currentTimeMs,
  durationMs,
  isPlaying,
  selected,
  onPlayToggle,
  onStop,
  onSeek
}: {
  currentTimeMs: number
  durationMs: number
  isPlaying: boolean
  selected: SubtitleLine
  onPlayToggle: () => void
  onStop: () => void
  onSeek: (value: number) => void
}): JSX.Element {
  return (
    <section className="timeline-dock grid min-h-0 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_minmax(8.5rem,0.4fr)] gap-5">
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(5.5rem,6.75rem)_minmax(0,1fr)] items-stretch gap-5">
        <div className="transport-tower">
          <button
            type="button"
            className="transport-tower__play"
            aria-label={isPlaying ? '暂停' : '播放'}
            onClick={onPlayToggle}
          >
            {isPlaying ? <PauseGlyph /> : '▶'}
          </button>
          <div className="transport-tower__shuttle" role="group" aria-label="时间轴快进快退">
            <button
              type="button"
              className="transport-tower__nudge"
              aria-label="后退 5 秒"
              onClick={() => onSeek(Math.max(0, currentTimeMs - 5000))}
            >
              ◀
            </button>
            <span className="transport-tower__shuttle-glyph" aria-hidden>
              ↔
            </span>
            <button
              type="button"
              className="transport-tower__nudge"
              aria-label="前进 5 秒"
              onClick={() => onSeek(Math.min(durationMs, currentTimeMs + 5000))}
            >
              ▶
            </button>
          </div>
          <button type="button" className="transport-tower__stop" aria-label="停止并重置到开头" onClick={onStop}>
            ■
          </button>
        </div>

        <div className="playback-shell min-w-0">
          <div className="type-timeline-rail mb-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 font-mono tabular-nums">
            <span className="shrink-0">{compactTime(currentTimeMs)}</span>
            <input
              className="timeline-range min-w-0"
              max={durationMs}
              min={0}
              step={100}
              type="range"
              value={currentTimeMs}
              onChange={(event) => onSeek(Number(event.currentTarget.value))}
            />
            <span className="shrink-0 text-right">{compactTime(durationMs)}</span>
          </div>

          <div className="playback-preview">
            <div className="max-w-3xl">
              <p className="playback-preview-zh">{selected.zh}</p>
              <p className="playback-preview-en">{selected.en}</p>
            </div>
          </div>
        </div>
      </div>

      <aside className="problems-panel min-w-0">
        <h3 className="ui-section-title">Problems</h3>
        <div className="mt-2 space-y-2">
          <ProblemItem label="Subtitle too long" />
          <ProblemItem label="Low confidence match" />
          <ProblemItem label="Reading speed too high" />
        </div>
      </aside>
    </section>
  )
}

function ProblemItem({ label }: { label: string }): JSX.Element {
  return <p className="problem-item">▲ {label}</p>
}

function AlignmentWorkflowModal({
  settings,
  subtitleCount,
  onClose,
  onRun
}: {
  settings: SettingsState
  subtitleCount: number
  onClose: () => void
  onRun: (draft: AlignmentWorkflowDraft) => void
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<AlignmentWorkflowDraft>(() => ({
    model: settings.model,
    batchSize: settings.batchSize,
    confidenceThreshold: settings.confidenceThreshold,
    mode: 'semanticHybrid',
    semanticStrength: 'medium',
    retryFailed: true
  }))

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
    setDraft((d) => ({
      ...d,
      model: settings.model,
      batchSize: settings.batchSize,
      confidenceThreshold: settings.confidenceThreshold
    }))
  }, [settings.model, settings.batchSize, settings.confidenceThreshold])

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose()
  }

  function patchDraft(patch: Partial<AlignmentWorkflowDraft>): void {
    setDraft((d) => ({ ...d, ...patch }))
  }

  const estTokens = estimateApiUsageTokens(draft, subtitleCount)
  const estLabel = estTokens >= 1000 ? `~${(estTokens / 1000).toFixed(1)}k tokens` : `~${estTokens} tokens`

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        className="modal-dialog modal-dialog--workflow"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alignment-workflow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header flex h-14 shrink-0 items-center justify-between px-5">
          <h2 id="alignment-workflow-title" className="text-primary text-[16px] font-semibold tracking-tight">
            Start AI Alignment
          </h2>
          <button
            type="button"
            className="text-meta rounded-lg px-2 text-2xl leading-none hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            aria-label="Close alignment workflow"
          >
            ×
          </button>
        </header>

        <div className="modal-body-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-secondary mb-4 text-[13px] leading-relaxed">
            Configure how the model processes your subtitles. Nothing runs until you choose <span className="text-primary font-medium">Run Alignment</span>.
          </p>

          <div className="space-y-5">
            <section className="settings-section">
              <h3 className="settings-heading">Model &amp; batches</h3>
              <label className="settings-label">
                Model
                <select className="settings-select mt-1 w-full" value={draft.model} onChange={(e) => patchDraft({ model: e.currentTarget.value })}>
                  <option>可选模型</option>
                  <option>deepseek-chat</option>
                  <option>deepseek-reasoner</option>
                </select>
              </label>
              <label className="settings-label mt-3">
                Batch size
                <select
                  className="settings-select mt-1 w-full"
                  value={draft.batchSize}
                  onChange={(e) => patchDraft({ batchSize: Number(e.currentTarget.value) })}
                >
                  <option value={8}>8</option>
                  <option value={12}>12</option>
                  <option value={16}>16</option>
                  <option value={20}>20</option>
                  <option value={24}>24</option>
                </select>
              </label>
              <label className="settings-label mt-3">
                Confidence threshold
                <select
                  className="settings-select mt-1 w-full"
                  value={draft.confidenceThreshold}
                  onChange={(e) => patchDraft({ confidenceThreshold: Number(e.currentTarget.value) })}
                >
                  <option value={60}>60%</option>
                  <option value={70}>70%</option>
                  <option value={80}>80%</option>
                  <option value={90}>90%</option>
                </select>
              </label>
            </section>

            <section className="settings-section">
              <h3 className="settings-heading">Alignment mode</h3>
              <p className="settings-label">How lines are matched to the script</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <RadioCard
                  checked={draft.mode === 'sequential'}
                  label="Sequential"
                  name="alignment-mode"
                  onChange={() => patchDraft({ mode: 'sequential' })}
                />
                <RadioCard
                  checked={draft.mode === 'semanticHybrid'}
                  label="Semantic hybrid"
                  name="alignment-mode"
                  onChange={() => patchDraft({ mode: 'semanticHybrid' })}
                />
              </div>
              <p className="settings-label mt-4">Semantic match strength</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <RadioCard
                  checked={draft.semanticStrength === 'low'}
                  label="Low"
                  name="semantic-strength"
                  onChange={() => patchDraft({ semanticStrength: 'low' })}
                />
                <RadioCard
                  checked={draft.semanticStrength === 'medium'}
                  label="Med"
                  name="semantic-strength"
                  onChange={() => patchDraft({ semanticStrength: 'medium' })}
                />
                <RadioCard
                  checked={draft.semanticStrength === 'high'}
                  label="High"
                  name="semantic-strength"
                  onChange={() => patchDraft({ semanticStrength: 'high' })}
                />
              </div>
              <div className="mt-4">
                <Toggle checked={draft.retryFailed} label="Retry failed matches" onChange={() => patchDraft({ retryFailed: !draft.retryFailed })} />
              </div>
            </section>

            <section className="settings-section">
              <h3 className="settings-heading">Estimates</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="metric-card">
                  <p className="type-field-label mb-1">Subtitle count</p>
                  <p className="type-panel-stat tabular-nums">{subtitleCount}</p>
                </div>
                <div className="metric-card">
                  <p className="type-field-label mb-1">Est. API usage</p>
                  <p className="type-panel-stat tabular-nums">{estLabel}</p>
                  <p className="type-caption mt-1">Heuristic before billing</p>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="modal-footer flex shrink-0 flex-wrap items-center justify-end gap-3 px-5 py-4">
          <button type="button" className="settings-footer-button btn-secondary-solid" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="settings-footer-button btn-accent-solid" onClick={() => onRun(draft)}>
            Run Alignment
          </button>
        </footer>
      </div>
    </div>
  )
}

function SettingsModal({
  settings,
  onChange,
  onClose
}: {
  settings: SettingsState
  onChange: (settings: SettingsState) => void
  onClose: () => void
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)

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

  function update(patch: Partial<SettingsState>): void {
    onChange({ ...settings, ...patch })
  }

  function handleBackdropClick(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        className="modal-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header flex h-14 shrink-0 items-center justify-between px-5">
          <h2 id="settings-modal-title" className="text-primary text-[16px] font-semibold tracking-tight">
            设置
          </h2>
          <button
            type="button"
            className="text-meta rounded-lg px-2 text-2xl leading-none hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            aria-label="关闭设置"
          >
            ×
          </button>
        </header>

        <div className="modal-body-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <SettingsContent settings={settings} onUpdate={update} />
        </div>

        <footer className="modal-footer flex shrink-0 justify-end gap-3 px-5 py-4">
          <button type="button" className="settings-footer-button btn-secondary-solid" onClick={onClose}>
            退出
          </button>
          <button type="button" className="settings-footer-button btn-accent-solid" onClick={onClose}>
            保存并应用
          </button>
        </footer>
      </div>
    </div>
  )
}

function SettingsContent({
  settings,
  onUpdate
}: {
  settings: SettingsState
  onUpdate: (patch: Partial<SettingsState>) => void
}): JSX.Element {
  return (
    <div className="space-y-5">
      <section className="settings-section">
        <h3 className="settings-heading">API 密钥</h3>
        <FieldRow label="服务商">
          <select className="settings-select" value={settings.provider} onChange={(event) => onUpdate({ provider: event.currentTarget.value })}>
            <option>Deepseek</option>
          </select>
        </FieldRow>
        <div className="mt-3 flex">
          <input
            className="settings-input rounded-r-none"
            placeholder="请输入 API Key"
            type="password"
            value={settings.apiKey}
            onChange={(event) => onUpdate({ apiKey: event.currentTarget.value })}
          />
          <button type="button" className="btn-paste">
            粘贴
          </button>
        </div>
        <button type="button" className="btn-accent-ghost mt-3 px-3 py-2 text-sm font-semibold">
          连接测试
        </button>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">AI 对齐设置</h3>
        <label className="settings-label">
          模型
          <select className="settings-select mt-1 w-full" value={settings.model} onChange={(event) => onUpdate({ model: event.currentTarget.value })}>
            <option>可选模型</option>
            <option>deepseek-chat</option>
          </select>
        </label>
        <label className="settings-label mt-3">
          每批条数
          <select
            className="settings-select mt-1 w-full"
            value={settings.batchSize}
            onChange={(event) => onUpdate({ batchSize: Number(event.currentTarget.value) })}
          >
            <option value={20}>20</option>
            <option value={12}>12</option>
          </select>
        </label>
        <label className="settings-label mt-3">
          置信度阈值
          <select
            className="settings-select mt-1 w-full"
            value={settings.confidenceThreshold}
            onChange={(event) => onUpdate({ confidenceThreshold: Number(event.currentTarget.value) })}
          >
            <option value={70}>70%</option>
            <option value={80}>80%</option>
          </select>
        </label>
        <div className="mt-4">
          <Toggle
            checked={settings.autoMarkHighConfidence}
            label="高置信度自动标记"
            onChange={() => onUpdate({ autoMarkHighConfidence: !settings.autoMarkHighConfidence })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">导出设置</h3>
        <p className="settings-label">字幕顺序</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RadioCard
            checked={settings.subtitleOrder === 'chineseFirst'}
            label="中文优先"
            name="subtitle-order"
            onChange={() => onUpdate({ subtitleOrder: 'chineseFirst' })}
          />
          <RadioCard
            checked={settings.subtitleOrder === 'englishFirst'}
            label="英文优先"
            name="subtitle-order"
            onChange={() => onUpdate({ subtitleOrder: 'englishFirst' })}
          />
        </div>
        <label className="settings-label mt-3">
          导出格式
          <select className="settings-select mt-1 w-full" value={settings.exportFormat} onChange={() => onUpdate({ exportFormat: '.srt' })}>
            <option>.srt</option>
          </select>
        </label>
        <div className="mt-4">
          <Toggle
            checked={settings.separateLines}
            label="中英文分行显示"
            onChange={() => onUpdate({ separateLines: !settings.separateLines })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">外观</h3>
        <p className="settings-label">主题</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RadioCard checked={settings.theme === 'light'} label="浅色" name="theme" onChange={() => onUpdate({ theme: 'light' })} />
          <RadioCard checked={settings.theme === 'dark'} label="深色" name="theme" onChange={() => onUpdate({ theme: 'dark' })} />
        </div>
        <label className="settings-label mt-3">
          字号
          <select
            className="settings-select mt-1 w-full"
            value={settings.fontSize}
            onChange={(event) => onUpdate({ fontSize: Number(event.currentTarget.value) })}
          >
            <option value={14}>14</option>
            <option value={16}>16</option>
          </select>
        </label>
      </section>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="settings-label grid grid-cols-[minmax(5.5rem,7.5rem)_minmax(0,1fr)] items-center gap-3">
      <span className="text-meta">{label}</span>
      {children}
    </label>
  )
}

function RadioCard({
  checked,
  label,
  name,
  onChange
}: {
  checked: boolean
  label: string
  name: string
  onChange: () => void
}): JSX.Element {
  return (
    <label className={`radio-card ${checked ? 'radio-card-selected' : ''}`}>
      <input checked={checked} className="sr-only" name={name} type="radio" onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function Toggle({
  checked,
  label,
  onChange
}: {
  checked: boolean
  label: string
  onChange: () => void
}): JSX.Element {
  const labelId = useId()

  return (
    <div className="setting-toggle">
      <span className="setting-toggle__label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        className="switch-root"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={onChange}
      >
        <span className="switch-track" data-state={checked ? 'checked' : 'unchecked'}>
          <span className="switch-thumb" aria-hidden />
        </span>
      </button>
    </div>
  )
}

export default App
