import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type ChangeEvent, type JSX, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { downloadBilingualSrt } from './lib/srtExporter'
import { parseSrt } from './lib/srtParser'
import { parseMixedTranscript } from './lib/mixedTranscriptParser'
import { EnglishScriptPoolPanel } from './components/EnglishScriptPoolPanel'
import { AiAlignmentWorkflowModal } from './components/AiAlignmentWorkflowModal'
import { AlignmentReviewPanel } from './components/AlignmentReviewPanel'
import { AlignmentAttemptsColumn } from './components/alignment/AlignmentAttemptsColumn'
import { VerticalStackSplitter } from './components/VerticalStackSplitter'
import { useHistoryStore } from './store/historyStore'
import { useScriptPoolStore } from './store/scriptPoolStore'
import {
  advanceReviewQueueId,
  buildGlobalReviewQueue,
  computeAlignmentRisk,
  isInAlignmentReviewQueue,
  markDuplicateAttemptKeys,
  runSingleSubtitleAlignmentRetry,
  startAlignmentSession,
  suggestBestAttempt
} from './lib/alignment'
import { segmentIdsEqual } from './lib/alignment/subtitleLineUtils'
import { formatProblemForDisplay } from './lib/alignment/applyPolicy'
import {
  isAlignmentSessionActive,
  useAlignmentSessionStore
} from './store/alignmentSessionStore'
import { selectCurrentSubtitle, useSubtitleStore } from './store/subtitleStore'
import { useBatchRetrySessionStore } from './store/batchRetrySessionStore'
import { useUiSettingsStore } from './store/uiSettingsStore'
import { useAlignmentReviewHotkeys, type AlignmentReviewHotkeyHandlers } from './hooks/useAlignmentReviewHotkeys'
import type { SettingsState, SubtitleStatus } from './types'
import { DEFAULT_USER_SETTINGS } from '../../shared/settingsDefaults'

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
  low_confidence: {
    label: 'Low Confidence',
    badgeClass: 'status-badge status-badge--low',
    dotClass: 'status-dot status-dot--low'
  },
  needs_review: {
    label: 'Needs Review',
    badgeClass: 'status-badge status-badge--low',
    dotClass: 'status-dot status-dot--low'
  },
  manual: {
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

function clampSettingsInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function parseSettingsInt(raw: string, min: number, max: number): number | null {
  if (raw === '' || raw === '-') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return null
  return clampSettingsInt(n, min, max)
}

function readStoredTheme(): 'light' | 'dark' {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

const defaultSettings: SettingsState = { ...DEFAULT_USER_SETTINGS }

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
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const selectSubtitle = useSubtitleStore((s) => s.selectSubtitle)
  const chineseSrtInputRef = useRef<HTMLInputElement>(null)
  const englishTxtInputRef = useRef<HTMLInputElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<SettingsState>(() => ({
    ...defaultSettings,
    theme: readStoredTheme()
  }))

  const handleExportBilingualSrt = useCallback(() => {
    downloadBilingualSrt(subtitles, {
      subtitleOrder: settings.subtitleOrder,
      separateLines: settings.separateLines
    })
  }, [subtitles, settings.subtitleOrder, settings.separateLines])

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [alignmentModalOpen, setAlignmentModalOpen] = useState(false)
  const sessionStatus = useAlignmentSessionStore((s) => s.status)
  const alignmentBusy = isAlignmentSessionActive(sessionStatus)
  const durationMs = subtitles[subtitles.length - 1]?.end ?? 1

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = settings.theme
  }, [settings.theme])

  useEffect(() => {
    const bridge = window.bilingualSubtitleAligner
    if (!bridge?.getUserSettings) return
    void bridge.getUserSettings().then(({ settings: loaded, loadedFromDisk }) => {
      setSettings({
        ...defaultSettings,
        ...loaded,
        ...(!loadedFromDisk ? { theme: readStoredTheme() } : {})
      })
    })
  }, [])

  const activeSubtitle = subtitles.find((subtitle) => currentTimeMs >= subtitle.start && currentTimeMs <= subtitle.end)
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
    if (activeId != null) selectSubtitle(activeId)
  }, [activeId, selectSubtitle])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const el = event.target
      if (
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) return
      if (event.shiftKey) return
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault()
        useHistoryStore.getState().undo()
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault()
        useHistoryStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  const handleChineseSrtFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const input = event.currentTarget
      const file = input.files?.[0]
      input.value = ''
      if (!file) return
      try {
        useHistoryStore.getState().clearUndoHistory()
        const raw = await file.text()
        const parsed = parseSrt(raw)
        const store = useSubtitleStore.getState()
        store.setSubtitles(parsed)
        const first = parsed[0]
        if (first) {
          store.selectSubtitle(first.id)
          setCurrentTimeMs(first.start)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        window.alert(`无法导入 SRT：${msg}`)
      }
    },
    []
  )

  const handleEnglishTxtFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.txt')) {
      window.alert('当前仅支持导入 .txt 英文原稿。')
      return
    }
    try {
      const raw = await file.text()
      const segments = parseMixedTranscript(raw)
      useScriptPoolStore.getState().setSegments(segments)
      if (segments.length === 0) {
        window.alert('文件内容为空，或未切分出任何句子。')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`无法导入英文文稿：${msg}`)
    }
  }, [])

  return (
    <>
      <main className="app-root app-workbench relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans text-[13px] leading-normal antialiased">
        <TopBar
          alignmentBusy={alignmentBusy}
          chineseSrtInputRef={chineseSrtInputRef}
          englishTxtInputRef={englishTxtInputRef}
          settingsOpen={settingsOpen}
          onChineseSrtFileChange={handleChineseSrtFileChange}
          onEnglishTxtFileChange={handleEnglishTxtFileChange}
          onExportBilingualSrt={handleExportBilingualSrt}
          onOpenAlignment={openAlignmentModal}
          onOpenSettings={openSettings}
        />

        <section className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(8.25rem,0.27fr)_minmax(0,1fr)_minmax(7rem,0.23fr)] grid-rows-[minmax(0,1fr)] gap-5 overflow-hidden">
          <SubtitleNavigator
            activeId={activeId}
            queueConfidenceThreshold={settings.confidenceThreshold}
            onSeekToSubtitle={setCurrentTimeMs}
          />

          <AlignmentWorkspace
            alignmentModel={settings.model}
            alignmentConfidenceThreshold={settings.confidenceThreshold}
            alignmentSessionBusy={alignmentBusy}
          />

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <VerticalStackSplitter
              top={<AlignmentStatus settings={settings} />}
              bottom={<EnglishScriptPoolPanel />}
            />
          </div>
        </section>

        <TimelineSimulator
          currentTimeMs={currentTimeMs}
          durationMs={durationMs}
          isPlaying={isPlaying}
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
            <AiAlignmentWorkflowModal
              settings={settings}
              onClose={closeAlignmentModal}
              onCommitAlignSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              onStartAlignment={(config) => startAlignmentSession(config, settings.apiKey)}
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
  onExportBilingualSrt,
  alignmentBusy,
  chineseSrtInputRef,
  englishTxtInputRef,
  onChineseSrtFileChange,
  onEnglishTxtFileChange
}: {
  settingsOpen: boolean
  onOpenSettings: () => void
  onOpenAlignment: () => void
  onExportBilingualSrt: () => void
  alignmentBusy: boolean
  chineseSrtInputRef: RefObject<HTMLInputElement | null>
  englishTxtInputRef: RefObject<HTMLInputElement | null>
  onChineseSrtFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  onEnglishTxtFileChange: (event: ChangeEvent<HTMLInputElement>) => void
}): JSX.Element {
  const canUndo = useHistoryStore((s) => s.undoStack.length > 0)
  const canRedo = useHistoryStore((s) => s.redoStack.length > 0)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  return (
    <header className="app-toolbar">
      <div className="app-toolbar__strip" role="toolbar" aria-label="主工具栏">
        <button
          type="button"
          className="toolbar-btn toolbar-btn--primary-action"
          onClick={onOpenAlignment}
        >
          整文件 AI 对齐
        </button>
        <span className="toolbar-sep" aria-hidden />
        <input
          ref={chineseSrtInputRef}
          accept=".srt,text/plain"
          className="sr-only"
          tabIndex={-1}
          type="file"
          aria-hidden
          onChange={onChineseSrtFileChange}
        />
        <button type="button" className="toolbar-btn" onClick={() => chineseSrtInputRef.current?.click()}>
          导入中文 SRT
        </button>
        <input
          ref={englishTxtInputRef}
          accept=".txt,text/plain"
          className="sr-only"
          tabIndex={-1}
          type="file"
          aria-hidden
          onChange={onEnglishTxtFileChange}
        />
        <button type="button" className="toolbar-btn" onClick={() => englishTxtInputRef.current?.click()}>
          导入英文文稿
        </button>
        <button type="button" className="toolbar-btn" onClick={onExportBilingualSrt}>
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
        <button
          type="button"
          className="toolbar-btn toolbar-btn--icon"
          aria-label="撤销"
          disabled={!canUndo}
          onClick={() => undo()}
        >
          <span className="toolbar-btn__glyph" aria-hidden>
            ↶
          </span>
        </button>
        <button
          type="button"
          className="toolbar-btn toolbar-btn--icon"
          aria-label="重做"
          disabled={!canRedo}
          onClick={() => redo()}
        >
          <span className="toolbar-btn__glyph" aria-hidden>
            ↷
          </span>
        </button>
      </div>

      <div className="app-toolbar__meta type-toolbar-meta hidden text-right sm:block">
        <p className="text-primary font-semibold">AI 对齐</p>
        <p className="text-secondary mt-0.5 leading-tight">
          {alignmentBusy ? '整文件对齐运行中…' : '一键对齐整份字幕'}
        </p>
      </div>
    </header>
  )
}

function SubtitleNavigator({
  activeId,
  queueConfidenceThreshold,
  onSeekToSubtitle
}: {
  activeId?: number
  queueConfidenceThreshold: number
  onSeekToSubtitle: (ms: number) => void
}): JSX.Element {
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const currentSubtitleId = useSubtitleStore((s) => s.currentSubtitleId)
  const selectSubtitle = useSubtitleStore((s) => s.selectSubtitle)

  const queueIdSet = useMemo(() => {
    const thr = queueConfidenceThreshold
    return new Set(subtitles.filter((l) => isInAlignmentReviewQueue(l, { confidenceThresholdPct: thr })).map((l) => l.id))
  }, [subtitles, queueConfidenceThreshold])

  return (
    <aside
      className="app-panel app-panel--sidebar flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-review-hotkeys="true"
    >
      <div className="app-panel-header nav-panel-head px-3 py-2">
        <h2 className="ui-section-title">Subtitles</h2>
        <p className="type-caption mt-0.5">{subtitles.length} lines</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2">
        {subtitles.length === 0 ? (
          <div className="type-caption text-meta rounded-lg border border-dashed border-[var(--color-border-subtle)] px-3 py-8 text-center leading-relaxed">
            暂无字幕
            <span className="mt-1 block text-[12px] text-[var(--color-text-meta)]">导入中文 SRT 后将在此列出</span>
          </div>
        ) : (
          subtitles.map((subtitle, index) => {
            const meta = statusMeta[subtitle.status]
            const isSelected = subtitle.id === currentSubtitleId
            const isActive = subtitle.id === activeId
            const displayIndex = index + 1
            const inQueue = queueIdSet.has(subtitle.id)
            const risk = inQueue
              ? computeAlignmentRisk(subtitle, { confidenceThresholdPct: queueConfidenceThreshold })
              : null

            return (
              <button
                key={subtitle.id}
                type="button"
                className={`subtitle-list-item${isSelected ? ' subtitle-list-item-selected' : ''}`}
                onClick={() => {
                  selectSubtitle(subtitle.id)
                  onSeekToSubtitle(subtitle.start)
                }}
              >
                <span className={meta.dotClass} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="type-nav-id tabular-nums">#{String(displayIndex).padStart(3, '0')}</span>
                    <span className="type-nav-time font-mono tabular-nums">{compactTime(subtitle.start)}</span>
                  </span>
                  <span className="type-nav-preview mt-0.5 block truncate text-left leading-snug">
                    {subtitle.chinese ? shortText(subtitle.chinese, 34) : '需要匹配'}
                  </span>
                  <span className={`${meta.badgeClass} nav-badge-offset`}>{meta.label}</span>
                </span>
                {inQueue && risk ? (
                  <span
                    className={`review-queue-pip review-queue-pip--${risk.band}`}
                    title={`复查队列 · 风险 ${risk.score} · ${risk.hints.join('；') || '无额外提示'}`}
                    aria-hidden
                  />
                ) : null}
                {isActive && <span className="subtitle-list-item-active-dot absolute right-2 top-2 h-1.5 w-1.5 rounded-full" />}
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}

function AlignmentWorkspace({
  alignmentModel,
  alignmentConfidenceThreshold,
  alignmentSessionBusy
}: {
  alignmentModel: string
  alignmentConfidenceThreshold: number
  alignmentSessionBusy: boolean
}): JSX.Element {
  const selected = useSubtitleStore((s) => selectCurrentSubtitle(s))
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const segments = useScriptPoolStore((s) => s.segments)
  const updateSubtitle = useSubtitleStore((s) => s.updateSubtitle)
  const replaceEnglish = useSubtitleStore((s) => s.replaceEnglish)
  const updateConfidence = useSubtitleStore((s) => s.updateConfidence)
  const applyAiAttempt = useSubtitleStore((s) => s.applySubtitleAiAttempt)
  const removeAiAttempt = useSubtitleStore((s) => s.removeSubtitleAiAttempt)
  const setPreferredSubtitleAttempt = useSubtitleStore((s) => s.setPreferredSubtitleAttempt)
  const [lineRetryBusy, setLineRetryBusy] = useState<'idle' | 'narrow' | 'wide'>('idle')
  const [selectedAttemptIndex, setSelectedAttemptIndex] = useState(0)
  const englishEditorRef = useRef<HTMLTextAreaElement>(null)
  const lineIdRef = useRef<number | null>(null)
  const hotkeyHandlersRef = useRef<AlignmentReviewHotkeyHandlers | null>(null)
  const chineseEditStartRef = useRef<{ subtitleId: number; text: string } | null>(null)
  const englishEditStartRef = useRef<{ subtitleId: number; text: string } | null>(null)

  const suggested = useMemo(() => {
    if (!selected) return null
    return suggestBestAttempt(selected, subtitles)
  }, [selected, subtitles])

  const dupIds = useMemo(() => {
    if (!selected) return new Map<string, boolean>()
    return markDuplicateAttemptKeys(selected.aiAttempts ?? [])
  }, [selected])

  const reviewQueue = useMemo(
    () => buildGlobalReviewQueue(subtitles, { confidenceThresholdPct: alignmentConfidenceThreshold }),
    [subtitles, alignmentConfidenceThreshold]
  )

  const reviewQueueIds = useMemo(() => reviewQueue.map((e) => e.line.id), [reviewQueue])

  const currentRisk = useMemo(() => {
    if (!selected) return null
    return computeAlignmentRisk(selected, { confidenceThresholdPct: alignmentConfidenceThreshold })
  }, [selected, alignmentConfidenceThreshold])

  const queuePosition = useMemo(() => {
    if (!selected) return null
    const i = reviewQueue.findIndex((e) => e.line.id === selected.id)
    if (i < 0) return null
    return { index: i + 1, total: reviewQueue.length }
  }, [reviewQueue, selected])

  function goNextReview(): void {
    const nextId = advanceReviewQueueId(reviewQueueIds, selected?.id ?? null, 1)
    if (nextId != null) useSubtitleStore.getState().selectSubtitle(nextId)
  }

  function goPrevReview(): void {
    const prevId = advanceReviewQueueId(reviewQueueIds, selected?.id ?? null, -1)
    if (prevId != null) useSubtitleStore.getState().selectSubtitle(prevId)
  }

  async function runLineRetry(wide: boolean): Promise<void> {
    if (!selected || lineRetryBusy !== 'idle' || alignmentSessionBusy) return
    const br = useBatchRetrySessionStore.getState().status
    if (br === 'running' || br === 'paused') return
    const lineId = selected.id
    setLineRetryBusy(wide ? 'wide' : 'narrow')
    try {
      const st = useSubtitleStore.getState()
      const fresh = st.subtitles.find((l) => l.id === lineId)
      if (!fresh) return
      await runSingleSubtitleAlignmentRetry({
        line: fresh,
        subtitles: st.subtitles,
        segments,
        model: alignmentModel,
        confidenceThresholdPct: alignmentConfidenceThreshold,
        wide
      })
    } finally {
      setLineRetryBusy('idle')
    }
  }

  const selectedAttemptIndexRef = useRef(0)
  selectedAttemptIndexRef.current = selectedAttemptIndex

  useEffect(() => {
    setSelectedAttemptIndex(0)
  }, [selected?.id])

  useLayoutEffect(() => {
    if (!selected) {
      hotkeyHandlersRef.current = null
      return
    }
    lineIdRef.current = selected.id
    const queueIds = reviewQueueIds
    const thr = alignmentConfidenceThreshold
    const busySession = alignmentSessionBusy

    hotkeyHandlersRef.current = {
      goNextReview: () => {
        const sid = useSubtitleStore.getState().currentSubtitleId
        const nextId = advanceReviewQueueId(queueIds, sid ?? null, 1)
        if (nextId != null) useSubtitleStore.getState().selectSubtitle(nextId)
      },
      goPrevReview: () => {
        const sid = useSubtitleStore.getState().currentSubtitleId
        const prevId = advanceReviewQueueId(queueIds, sid ?? null, -1)
        if (prevId != null) useSubtitleStore.getState().selectSubtitle(prevId)
      },
      stepAttempt: (dir) => {
        setSelectedAttemptIndex((prev) => {
          const lid = lineIdRef.current
          if (lid == null) return prev
          const cur = useSubtitleStore.getState().subtitles.find((l) => l.id === lid)
          const sorted = [...(cur?.aiAttempts ?? [])].sort((a, b) => b.createdAt - a.createdAt)
          if (sorted.length === 0) return 0
          const max = sorted.length - 1
          return Math.min(max, Math.max(0, prev + dir))
        })
      },
      applySelectedAttempt: () => {
        const lid = lineIdRef.current
        if (lid == null) return
        const cur = useSubtitleStore.getState().subtitles.find((l) => l.id === lid)
        if (!cur) return
        const sorted = [...(cur.aiAttempts ?? [])].sort((a, b) => b.createdAt - a.createdAt)
        if (sorted.length === 0) return
        const idx = Math.min(Math.max(0, selectedAttemptIndexRef.current), sorted.length - 1)
        const att = sorted[idx]
        if (att?.english.trim()) {
          useSubtitleStore.getState().applySubtitleAiAttempt(lid, att.id, thr)
        }
      },
      retryLine: (wide) => {
        const br = useBatchRetrySessionStore.getState().status
        if (br === 'running' || br === 'paused') return
        if (lineRetryBusy !== 'idle' || busySession) return
        const lid = lineIdRef.current
        if (lid == null) return
        setLineRetryBusy(wide ? 'wide' : 'narrow')
        void (async () => {
          try {
            const st = useSubtitleStore.getState()
            const fresh = st.subtitles.find((l) => l.id === lid)
            if (!fresh) return
            await runSingleSubtitleAlignmentRetry({
              line: fresh,
              subtitles: st.subtitles,
              segments: useScriptPoolStore.getState().segments,
              model: alignmentModel,
              confidenceThresholdPct: thr,
              wide
            })
          } finally {
            setLineRetryBusy('idle')
          }
        })()
      },
      markConfirmed: () => {
        const lid = lineIdRef.current
        if (lid == null) return
        const cur = useSubtitleStore.getState().subtitles.find((l) => l.id === lid)
        if (!cur?.english.trim()) return
        useSubtitleStore.getState().updateSubtitle(lid, { status: 'confirmed' })
      },
      focusEnglish: () => {
        englishEditorRef.current?.focus()
      }
    }
  }, [
    selected,
    reviewQueueIds,
    alignmentConfidenceThreshold,
    alignmentModel,
    alignmentSessionBusy,
    lineRetryBusy
  ])

  useAlignmentReviewHotkeys(Boolean(selected), hotkeyHandlersRef)

  if (!selected) {
    return (
      <section className="app-panel app-panel--primary flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="app-panel-header workspace-head shrink-0 px-4 py-3">
          <p className="type-field-label">当前字幕</p>
          <h1 className="type-workspace-id mt-1 text-[var(--color-text-meta)]">—</h1>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto p-8 text-center">
          <p className="text-primary text-[15px] font-semibold">暂无字幕</p>
          <p className="type-caption max-w-sm text-secondary leading-relaxed">
            当前项目没有字幕行。请使用工具栏「导入中文 SRT」选择 `.srt` 文件载入。
          </p>
        </div>
      </section>
    )
  }

  const line = selected
  const lineInQueue = isInAlignmentReviewQueue(line, { confidenceThresholdPct: alignmentConfidenceThreshold })
  const meta = statusMeta[line.status]

  function applyCandidate(candidateId: string): void {
    const match = line.candidates.find((c) => c.id === candidateId)
    if (!match) return
    replaceEnglish(line.id, match.text, match.segmentIds)
    updateConfidence(line.id, match.confidence)
  }

  return (
    <section className="app-panel app-panel--primary flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="app-panel-header workspace-head shrink-0 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div>
            <p className="type-field-label">Current Subtitle</p>
            <h1 className="type-workspace-id mt-1">#{String(line.id).padStart(3, '0')}</h1>
            <p className="type-workspace-time mt-1 font-mono tabular-nums">
              {formatTime(line.start)} → {formatTime(line.end)}
            </p>
          </div>
          <span className={meta.badgeClass}>{meta.label}</span>
        </div>
        <p className="workspace-phase-strip type-caption mt-2 rounded-md px-2 py-1.5 leading-snug">
          <span className="workspace-phase-strip__lead font-medium">Phase 4B · Review & Attempts</span>
          {' · '}
          快捷键 K/J 队列 · A/D 尝试 · Enter 应用 · R / Shift+R 重试 · M 确认 · E 聚焦英文
          {' · '}
          全文件队列 {reviewQueue.length} 条（按风险分排序，仅导航）
          {queuePosition ? (
            <>
              {' · '}
              当前排位 <span className="tabular-nums">{queuePosition.index}/{queuePosition.total}</span>
            </>
          ) : (
            <> · 当前行不在复查队列</>
          )}
          {lineInQueue && currentRisk ? (
            <>
              {' · '}
              风险 <span className="tabular-nums">{currentRisk.score}</span>（
              {currentRisk.band === 'high' ? '高' : currentRisk.band === 'elevated' ? '中' : '低'}）
              {currentRisk.hints.length > 0 ? ` · ${currentRisk.hints.join('；')}` : ''}
            </>
          ) : null}
        </p>
      </div>

      <div
        className="workspace-body flex min-h-0 flex-1 flex-col overflow-hidden p-4"
        data-alignment-review-surface="true"
      >
        <VerticalStackSplitter
          defaultTopRatio={0.52}
          top={
            <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-1">
          <label className="block">
            <span className="type-field-label mb-1.5 block">Chinese Subtitle</span>
            <textarea
              key={`zh-${line.id}`}
              className="subtitle-editor subtitle-editor--dense"
              data-subtitle-id={line.id}
              value={line.chinese}
              onFocus={() => {
                chineseEditStartRef.current = { subtitleId: line.id, text: line.chinese }
              }}
              onBlur={(event) => {
                const fieldLineId = Number(event.currentTarget.dataset.subtitleId)
                const start = chineseEditStartRef.current
                if (!start || start.subtitleId !== fieldLineId) return
                chineseEditStartRef.current = null
                const after = event.currentTarget.value
                if (start.text !== after) {
                  useHistoryStore.getState().recordTextEditIfChanged({
                    subtitleId: start.subtitleId,
                    field: 'chinese',
                    before: start.text,
                    after
                  })
                }
              }}
              onChange={(event) =>
                updateSubtitle(line.id, {
                  chinese: event.currentTarget.value,
                  manuallyEdited: true,
                  status: 'manual'
                })
              }
            />
          </label>

          <label className="block">
            <span className="type-field-label mb-1.5 block">English Subtitle</span>
            <textarea
              ref={englishEditorRef}
              key={`en-${line.id}`}
              className="subtitle-editor subtitle-editor--dense"
              data-subtitle-id={line.id}
              value={line.english}
              onFocus={() => {
                englishEditStartRef.current = { subtitleId: line.id, text: line.english }
              }}
              onBlur={(event) => {
                const fieldLineId = Number(event.currentTarget.dataset.subtitleId)
                const start = englishEditStartRef.current
                if (!start || start.subtitleId !== fieldLineId) return
                englishEditStartRef.current = null
                const after = event.currentTarget.value
                if (start.text !== after) {
                  useHistoryStore.getState().recordTextEditIfChanged({
                    subtitleId: start.subtitleId,
                    field: 'english',
                    before: start.text,
                    after
                  })
                }
              }}
              onChange={(event) =>
                updateSubtitle(line.id, {
                  english: event.currentTarget.value,
                  manuallyEdited: true,
                  status: 'manual',
                  matchedSegmentIds: []
                })
              }
            />
          </label>

          <div className="candidate-well">
            <div className="candidate-well__head mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div>
                <h2 className="type-panel-title">AI Candidate Matches</h2>
                <p className="type-caption mt-0.5">Line confidence {line.confidence}%</p>
              </div>
              <div className="confidence-track confidence-track--compact w-24">
                <div className="confidence-fill" style={{ width: `${line.confidence}%` }} />
              </div>
            </div>

            <div className="candidate-stack">
              {line.candidates.map((candidate) => {
                const isActive =
                  candidate.text === line.english &&
                  segmentIdsEqual(candidate.segmentIds, line.matchedSegmentIds ?? [])

                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`candidate-card${isActive ? ' candidate-card--selected' : ''}`}
                    onClick={() => applyCandidate(candidate.id)}
                  >
                    <div className="candidate-card__top-row flex w-full flex-wrap items-start justify-between gap-2">
                      <span className="candidate-score">{candidate.confidence}%</span>
                      <span className="candidate-seg-count tabular-nums">
                        {candidate.segmentIds.length} segment{candidate.segmentIds.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <span className="type-candidate-text mt-1.5 min-w-0 flex-1 text-left">{candidate.text}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="type-panel-title">复查队列与重试</h2>
              <span className="type-caption text-meta">{line.aiAttempts?.length ?? 0} 条尝试</span>
            </div>
            <div className="mb-3 flex flex-wrap gap-2" data-review-hotkeys="true">
              <button
                type="button"
                className="toolbar-btn toolbar-btn--panel text-[12px]"
                disabled={reviewQueue.length === 0}
                onClick={() => goPrevReview()}
              >
                上一条（队列）
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn--panel text-[12px]"
                disabled={reviewQueue.length === 0}
                onClick={() => goNextReview()}
              >
                下一条（队列）
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn--panel text-[12px]"
                disabled={!suggested}
                onClick={() => {
                  if (!suggested) return
                  applyAiAttempt(line.id, suggested.id, alignmentConfidenceThreshold)
                }}
              >
                应用推荐尝试
              </button>
              <button
                type="button"
                className="toolbar-btn toolbar-btn--panel text-[12px]"
                disabled={!line.english.trim()}
                onClick={() => updateSubtitle(line.id, { status: 'confirmed' })}
              >
                标记已确认
              </button>
            </div>
            <p className="type-caption mb-1 text-meta">当前应用（confidence {line.confidence}%）</p>
            <p className="type-caption line-clamp-3 text-secondary" title={line.english}>
              {line.english.trim() ? line.english : '（空）'}
            </p>
          </section>
            </div>
          }
          bottom={
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden pt-1">
              <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-col overflow-hidden lg:max-w-none">
                <AlignmentAttemptsColumn
                  line={line}
                  subtitles={subtitles}
                  segments={segments}
                  alignmentModel={alignmentModel}
                  alignmentConfidenceThreshold={alignmentConfidenceThreshold}
                  suggested={suggested}
                  dupIds={dupIds}
                  selectedAttemptIndex={selectedAttemptIndex}
                  onSelectedAttemptIndexChange={setSelectedAttemptIndex}
                  applyAiAttempt={applyAiAttempt}
                  removeAiAttempt={removeAiAttempt}
                  setPreferredAttempt={setPreferredSubtitleAttempt}
                  lineRetryBusy={lineRetryBusy}
                  alignmentSessionBusy={alignmentSessionBusy}
                  onRetryNarrow={() => void runLineRetry(false)}
                  onRetryWide={() => void runLineRetry(true)}
                />
              </div>
            </div>
          }
        />
      </div>
    </section>
  )
}

const sessionStatusLabel: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止'
}

function AlignmentStatus({ settings }: { settings: SettingsState }): JSX.Element {
  const debugMode = useUiSettingsStore((s) => s.debugMode)
  const subtitles = useSubtitleStore((s) => s.subtitles)
  const sessionStatus = useAlignmentSessionStore((s) => s.status)
  const progressPct = useAlignmentSessionStore((s) => s.progressPct)
  const lastSummary = useAlignmentSessionStore((s) => s.lastSummary)
  const lastError = useAlignmentSessionStore((s) => s.lastError)
  const currentBatchIndex = useAlignmentSessionStore((s) => s.currentBatchIndex)
  const totalBatches = useAlignmentSessionStore((s) => s.totalBatches)
  const currentBatchLabel = useAlignmentSessionStore((s) => s.currentBatchLabel)
  const processedSubtitleCount = useAlignmentSessionStore((s) => s.processedSubtitleCount)
  const totalSubtitleCount = useAlignmentSessionStore((s) => s.totalSubtitleCount)
  const processingSubtitleId = useAlignmentSessionStore((s) => s.processingSubtitleId)
  const sessionMatchedCount = useAlignmentSessionStore((s) => s.sessionMatchedCount)
  const sessionNeedsReviewCount = useAlignmentSessionStore((s) => s.sessionNeedsReviewCount)
  const sessionFailedCount = useAlignmentSessionStore((s) => s.sessionFailedCount)
  const coverageRetryPhase = useAlignmentSessionStore((s) => s.coverageRetryPhase)
  const firstPassMatchedCount = useAlignmentSessionStore((s) => s.firstPassMatchedCount)
  const retryMatchedDeltaCount = useAlignmentSessionStore((s) => s.retryMatchedDeltaCount)
  const retryStillNeedsReviewCount = useAlignmentSessionStore((s) => s.retryStillNeedsReviewCount)
  const finalReport = useAlignmentSessionStore((s) => s.finalReport)
  const bridge = typeof window !== 'undefined' ? window.bilingualSubtitleAligner : undefined
  const aiReady = Boolean(bridge?.alignDeepSeekBatch)

  const matchedLines = subtitles.filter((l) => l.english.trim().length > 0).length
  const lowConfidenceLines = subtitles.filter((l) => l.status === 'low_confidence').length
  const attentionLines = subtitles.filter(
    (l) =>
      l.status === 'needs_review' ||
      l.status === 'low_confidence' ||
      l.problems.length > 0
  ).length

  const modeLabel = sessionStatus === 'idle' ? '—' : '整文件自动对齐'

  return (
    <aside className="app-panel alignment-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="app-panel-header alignment-panel__head shrink-0 px-4 py-2.5">
        <h2 className="ui-section-title">对齐</h2>
        {debugMode ? (
          <p className="type-caption alignment-monitor-tag mt-1">开发者 · 会话监控</p>
        ) : (
          <p className="type-caption mt-1 text-secondary">进度与当前批次</p>
        )}
        {debugMode ? (
          <p className="type-caption mt-1 leading-snug">
            {settings.provider} · <span className="text-secondary">{settings.model}</span>
          </p>
        ) : null}
      </div>

      <div className="alignment-panel__body min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2.5">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="type-field-label">对齐会话</p>
            <span className="type-caption font-semibold text-primary">
              {sessionStatusLabel[sessionStatus] ?? sessionStatus}
            </span>
          </div>
          {debugMode ? <Metric label="模式" value={modeLabel} /> : null}
          {debugMode ? <Metric label="AI Ready" value={aiReady ? '是' : '否'} /> : null}
          <div className="mt-2">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="type-field-label">进度</span>
              <span className="type-run-pct tabular-nums">{progressPct}%</span>
            </div>
            <div className="alignment-progress-track">
              <div
                className="alignment-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <p className="type-caption mt-2 leading-snug text-meta">{lastSummary}</p>
          {lastError ? (
            <p className="type-caption mt-1 leading-snug text-red-500">{lastError}</p>
          ) : null}
        </div>

        <AlignmentReviewPanel />

        <div className="metric-stack space-y-3">
          <Metric
            label="当前批次"
            value={totalBatches > 0 ? `${currentBatchIndex} / ${totalBatches}` : '—'}
          />
          <Metric label="批次范围" value={currentBatchLabel} />
          <Metric
            label="已处理字幕"
            value={`${processedSubtitleCount} / ${totalSubtitleCount || subtitles.length}`}
          />
          <Metric
            label="当前处理行"
            value={processingSubtitleId != null ? `#${processingSubtitleId}` : '—'}
          />
        </div>

        {debugMode ? (
          <div className="metric-stack space-y-3">
            <p className="type-field-label">Coverage · Retry</p>
            <Metric label="首轮较好匹配" value={String(firstPassMatchedCount)} />
            <Metric
              label="Retry 阶段"
              value={
                sessionStatus === 'idle' && coverageRetryPhase === 'idle'
                  ? '—'
                  : coverageRetryPhase === 'running'
                    ? '进行中'
                    : coverageRetryPhase === 'completed'
                      ? '已完成'
                      : '—'
              }
            />
            <Metric label="Retry 补齐" value={String(retryMatchedDeltaCount)} />
            <Metric label="仍待复查" value={String(retryStillNeedsReviewCount)} />
          </div>
        ) : null}

        <div className="metric-stack space-y-3">
          <p className="type-field-label">{debugMode ? '本会话统计' : '本阶段统计'}</p>
          <Metric label="匹配" value={String(sessionMatchedCount)} />
          <Metric label="需复查" value={String(sessionNeedsReviewCount)} />
          {debugMode ? <Metric label="失败" value={String(sessionFailedCount)} /> : null}
        </div>

        {finalReport ? (
          <div className="metric-stack space-y-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2.5">
            <p className="type-field-label">{debugMode ? '整文件报告' : '整文件摘要'}</p>
            <Metric
              label="已匹配"
              value={`${finalReport.matchedSubtitleCount} / ${finalReport.totalSubtitleCount}`}
            />
            <Metric label="需复查" value={String(finalReport.needsReviewCount)} />
            <Metric label="未匹配" value={String(finalReport.unmatchedCount)} />
            {debugMode ? (
              <>
                <Metric label="未用英文段" value={String(finalReport.unusedEnglishSegmentIds.length)} />
                <Metric label="重复 segment" value={String(finalReport.duplicateSegmentIds.length)} />
              </>
            ) : null}
          </div>
        ) : null}

        {debugMode ? (
          <div className="metric-stack space-y-3">
            <p className="type-field-label">字幕全局</p>
            <Metric label="已填英文" value={`${matchedLines} / ${subtitles.length}`} />
            <Metric label="低置信度" value={String(lowConfidenceLines)} />
            <Metric label="待复查行" value={String(attentionLines)} />
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] p-2.5 text-[12px] text-secondary">
            <span className="text-meta">已填英文 </span>
            <span className="font-semibold text-primary tabular-nums">
              {matchedLines}/{subtitles.length}
            </span>
            <span className="mx-2 text-meta">·</span>
            <span className="text-meta">待复查 </span>
            <span className="font-semibold text-primary tabular-nums">{attentionLines}</span>
          </div>
        )}

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
  onPlayToggle,
  onStop,
  onSeek
}: {
  currentTimeMs: number
  durationMs: number
  isPlaying: boolean
  onPlayToggle: () => void
  onStop: () => void
  onSeek: (value: number) => void
}): JSX.Element {
  const selected = useSubtitleStore((s) => selectCurrentSubtitle(s))
  return (
    <section className="timeline-dock grid min-h-0 min-w-0 shrink-0 grid-cols-[minmax(0,1fr)_minmax(8.5rem,0.4fr)] gap-5 overflow-hidden">
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(5.5rem,6.75rem)_minmax(0,1fr)] grid-rows-1 items-stretch gap-5 overflow-hidden">
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

        <div className="playback-shell flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="type-timeline-rail mb-2 grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 font-mono tabular-nums">
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

          <div className="playback-preview min-h-0 flex-1">
            <div className="max-w-3xl">
              {selected ? (
                <>
                  <p className="playback-preview-zh">{selected.chinese || '（无中文）'}</p>
                  <p className="playback-preview-en">{selected.english || '（无英文）'}</p>
                </>
              ) : (
                <>
                  <p className="playback-preview-zh text-[var(--color-text-meta)]">暂无字幕可预览</p>
                  <p className="playback-preview-en text-[var(--color-text-meta)]">导入字幕后将显示当前行</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <aside className="problems-panel flex min-h-0 min-w-0 flex-col overflow-hidden">
        <h3 className="ui-section-title shrink-0">Problems</h3>
        <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
          {!selected ? (
            <p className="type-caption text-meta px-1 leading-relaxed">无选中字幕行；导入字幕后再查看本行问题。</p>
          ) : selected.problems.length === 0 ? (
            <p className="type-caption text-meta px-1">本行无问题</p>
          ) : (
            selected.problems.map((problem) => <ProblemItem key={problem} label={problem} />)
          )}
        </div>
      </aside>
    </section>
  )
}

function ProblemItem({ label }: { label: string }): JSX.Element {
  return <p className="problem-item">▲ {formatProblemForDisplay(label)}</p>
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

  async function saveAndClose(): Promise<void> {
    const bridge = window.bilingualSubtitleAligner
    if (!bridge?.setUserSettings) {
      window.alert('无法保存设置：Electron 安全桥接未加载，请重启应用后重试。')
      return
    }
    try {
      const saved = await bridge.setUserSettings(settings)
      onChange(saved)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      window.alert(`无法保存设置：${msg}`)
    }
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
        <header className="modal-header shrink-0">
          <h2 id="settings-modal-title" className="min-w-0 flex-1 truncate text-left text-[16px] font-semibold tracking-tight text-primary">
            设置
          </h2>
          <button
            type="button"
            className="text-meta shrink-0 rounded-lg px-2 text-2xl leading-none hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            aria-label="关闭设置"
          >
            ×
          </button>
        </header>

        <div className="modal-body-scroll min-h-0 flex-1 overflow-y-auto">
          <SettingsContent settings={settings} onUpdate={update} />
        </div>

        <footer className="modal-footer shrink-0">
          <button type="button" className="settings-footer-button btn-secondary-solid" onClick={onClose}>
            退出
          </button>
          <button
            type="button"
            className="settings-footer-button btn-accent-solid"
            onClick={() => void saveAndClose()}
          >
            保存并应用
          </button>
        </footer>
      </div>
    </div>
  )
}

type DeepSeekTestUiState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'connected' }
  | { phase: 'failed'; message: string }

function SettingsContent({
  settings,
  onUpdate
}: {
  settings: SettingsState
  onUpdate: (patch: Partial<SettingsState>) => void
}): JSX.Element {
  const [deepSeekTest, setDeepSeekTest] = useState<DeepSeekTestUiState>({ phase: 'idle' })
  const debugMode = useUiSettingsStore((s) => s.debugMode)
  const setDebugMode = useUiSettingsStore((s) => s.setDebugMode)

  async function handleTestDeepSeekConnection(): Promise<void> {
    const bridge = window.bilingualSubtitleAligner
    if (!bridge?.testDeepSeekConnection) {
      setDeepSeekTest({ phase: 'failed', message: 'Connection test is only available in the desktop app.' })
      return
    }
    if (!settings.apiKey.trim()) {
      setDeepSeekTest({ phase: 'failed', message: 'Please enter DeepSeek API Key.' })
      return
    }
    setDeepSeekTest({ phase: 'testing' })
    try {
      const result = await bridge.testDeepSeekConnection(settings.apiKey, settings.model)
      if (result.ok) setDeepSeekTest({ phase: 'connected' })
      else setDeepSeekTest({ phase: 'failed', message: result.error })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setDeepSeekTest({ phase: 'failed', message: msg })
    }
  }

  async function handlePasteApiKey(): Promise<void> {
    try {
      const bridge = window.bilingualSubtitleAligner
      const text = bridge?.readClipboardText
        ? await bridge.readClipboardText()
        : await navigator.clipboard.readText()
      onUpdate({ apiKey: text.trim() })
    } catch {
      window.alert('无法读取剪贴板，请检查权限或在本框内使用 Ctrl+V 粘贴。')
    }
  }

  return (
    <div className="modal-section-stack">
      <section className="settings-section">
        <h3 className="settings-heading">API 密钥</h3>
        <FieldRow label="服务商">
          <select className="settings-select" value={settings.provider} onChange={(event) => onUpdate({ provider: event.currentTarget.value })}>
            <option>Deepseek</option>
          </select>
        </FieldRow>
        <div className="mt-2 flex">
          <input
            className="settings-input rounded-r-none"
            placeholder="请输入 API Key"
            type="password"
            value={settings.apiKey}
            onChange={(event) => onUpdate({ apiKey: event.currentTarget.value })}
          />
          <button type="button" className="btn-paste" onClick={() => void handlePasteApiKey()}>
            粘贴
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-accent-ghost px-3 py-2 text-sm font-semibold"
            disabled={deepSeekTest.phase === 'testing'}
            onClick={() => void handleTestDeepSeekConnection()}
          >
            Test Connection
          </button>
        </div>
        {deepSeekTest.phase === 'testing' ? (
          <p className="type-caption mt-2 text-[var(--color-text-secondary)]">Testing...</p>
        ) : null}
        {deepSeekTest.phase === 'connected' ? (
          <p className="type-caption mt-2 font-medium text-emerald-600 dark:text-emerald-400">Connected</p>
        ) : null}
        {deepSeekTest.phase === 'failed' ? (
          <p className="type-caption mt-2 text-red-600 dark:text-red-400">Failed: {deepSeekTest.message}</p>
        ) : null}
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
        <label className="settings-label mt-2">
          每批条数
          <input
            type="number"
            className="settings-input mt-1 w-full"
            min={1}
            max={500}
            step={1}
            value={settings.batchSize}
            onChange={(event) => {
              const next = parseSettingsInt(event.currentTarget.value, 1, 500)
              if (next === null) return
              onUpdate({ batchSize: next })
            }}
          />
        </label>
        <label className="settings-label mt-2">
          置信度阈值
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <input
              type="number"
              className="settings-input min-w-0 flex-1"
              min={0}
              max={100}
              step={1}
              value={settings.confidenceThreshold}
              onChange={(event) => {
                const next = parseSettingsInt(event.currentTarget.value, 0, 100)
                if (next === null) return
                onUpdate({ confidenceThreshold: next })
              }}
            />
            <span className="text-meta shrink-0 text-[13px] font-medium">%</span>
          </div>
        </label>
        <div className="mt-3">
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
        <label className="settings-label mt-2">
          导出格式
          <select className="settings-select mt-1 w-full" value={settings.exportFormat} onChange={() => onUpdate({ exportFormat: '.srt' })}>
            <option>.srt</option>
          </select>
        </label>
        <div className="mt-3">
          <Toggle
            checked={settings.separateLines}
            label="中英文分行显示"
            onChange={() => onUpdate({ separateLines: !settings.separateLines })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">界面与调试</h3>
        <Toggle
          checked={debugMode}
          label="开发者模式（span / Raw / 校验详情）"
          onChange={() => setDebugMode(!debugMode)}
        />
        <p className="type-caption mt-2 text-secondary leading-relaxed">
          默认关闭：对齐面板仅显示本批字幕、模型英文与操作按钮。开启后显示时间窗、解析警告、候选组与原始响应等内部诊断信息。
        </p>
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">外观</h3>
        <p className="settings-label">主题</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RadioCard checked={settings.theme === 'light'} label="浅色" name="theme" onChange={() => onUpdate({ theme: 'light' })} />
          <RadioCard checked={settings.theme === 'dark'} label="深色" name="theme" onChange={() => onUpdate({ theme: 'dark' })} />
        </div>
        <label className="settings-label mt-2">
          字号
          <input
            type="number"
            className="settings-input mt-1 w-full"
            min={10}
            max={40}
            step={1}
            value={settings.fontSize}
            onChange={(event) => {
              const next = parseSettingsInt(event.currentTarget.value, 10, 40)
              if (next === null) return
              onUpdate({ fontSize: next })
            }}
          />
        </label>
      </section>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="settings-label grid grid-cols-[minmax(4.5rem,6rem)_minmax(0,1fr)] items-center gap-2">
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
