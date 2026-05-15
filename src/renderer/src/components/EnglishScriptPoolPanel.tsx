import { useMemo, type JSX } from 'react'
import type { ScriptPoolListFilter, ScriptSegmentLanguage } from '../types'
import { filterEnglishPoolSegments } from '../lib/alignment'
import { filterScriptSegmentsForList, useScriptPoolStore } from '../store/scriptPoolStore'
import { useAlignmentPreviewStore } from '../store/alignmentPreviewStore'

function shortPreview(text: string, max = 120): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function languageBadgeLabel(lang: ScriptSegmentLanguage): string {
  if (lang === 'english') return 'EN'
  if (lang === 'chinese') return 'ZH'
  if (lang === 'mixed') return 'MIX'
  return 'UNK'
}

function languageBadgeClass(lang: ScriptSegmentLanguage): string {
  if (lang === 'english') return 'script-pool-badge script-pool-badge--en'
  if (lang === 'chinese') return 'script-pool-badge script-pool-badge--zh'
  if (lang === 'mixed') return 'script-pool-badge script-pool-badge--mix'
  return 'script-pool-badge script-pool-badge--unk'
}

/** 与解析器一致：无汉字且含数字 → 可走假 AI 英文顺序流（旧数据可能仍为 UNK）。 */
function isDigitLikeAlignableScript(text: string): boolean {
  return /[0-9\uFF10-\uFF19]/.test(text) && !/[\u3400-\u9fff\uf900-\ufaff]/.test(text)
}

const FILTER_OPTIONS: { id: ScriptPoolListFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'english', label: '仅英文' },
  { id: 'mixed', label: '混排' },
  { id: 'chinese', label: '中文' }
]

export function EnglishScriptPoolPanel(): JSX.Element {
  const segments = useScriptPoolStore((s) => s.segments)
  const listFilter = useScriptPoolStore((s) => s.listFilter)
  const setListFilter = useScriptPoolStore((s) => s.setListFilter)
  const selectedSegmentId = useScriptPoolStore((s) => s.selectedSegmentId)
  const selectSegment = useScriptPoolStore((s) => s.selectSegment)
  const setEnglishCursor = useAlignmentPreviewStore((s) => s.setEnglishCursor)

  const visible = useMemo(() => filterScriptSegmentsForList(segments, listFilter), [segments, listFilter])

  const englishPoolIndexById = useMemo(() => {
    const pool = filterEnglishPoolSegments(segments)
    const m = new Map<string, number>()
    pool.forEach((s, i) => m.set(s.id, i))
    return m
  }, [segments])

  return (
    <aside className="app-panel script-pool-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="app-panel-header script-pool-panel__head shrink-0 px-3 py-2">
        <h2 className="ui-section-title">Script Pool</h2>
        <p className="type-caption mt-0.5">
          {segments.length} 条
          {listFilter !== 'all' ? ` · 显示 ${visible.length}` : null}
        </p>
        <div className="script-pool-filter mt-2 flex flex-wrap gap-1.5" role="toolbar" aria-label="脚本池筛选">
          {FILTER_OPTIONS.map((opt) => {
            const active = listFilter === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                className={`script-pool-filter__btn${active ? ' script-pool-filter__btn--active' : ''}`}
                aria-pressed={active}
                onClick={() => setListFilter(opt.id)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2">
        {segments.length === 0 ? (
          <div className="type-caption text-meta rounded-lg border border-dashed border-[var(--color-border-subtle)] px-3 py-6 text-center leading-relaxed">
            暂无原稿脚本
            <span className="mt-1 block text-[12px] text-[var(--color-text-meta)]">
              使用工具栏「导入英文文稿」载入 .txt（支持中英混排、说话人行等）
            </span>
          </div>
        ) : visible.length === 0 ? (
          <div className="type-caption text-meta rounded-lg border border-dashed border-[var(--color-border-subtle)] px-3 py-6 text-center leading-relaxed">
            当前筛选下无条目
            <span className="mt-1 block text-[12px] text-[var(--color-text-meta)]">请切换筛选或导入其它内容</span>
          </div>
        ) : (
          visible.map((seg, index) => {
            const displayIndex = index + 1
            const isSelected = seg.id === selectedSegmentId
            const alignPoolIdx = englishPoolIndexById.get(seg.id)

            return (
              <div
                key={seg.id}
                className={`script-pool-item !p-0 !gap-0${isSelected ? ' script-pool-item--selected' : ''}`}
              >
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--color-bg-hover)]"
                  title={
                    seg.language === 'english'
                      ? seg.used
                        ? '默认参与假 AI 英文候选（按 EN 顺序推进）'
                        : '纯英文片段；当前未标为对齐池（used）'
                      : seg.language === 'chinese' || seg.language === 'mixed'
                        ? '仅作对齐上下文展示；假 AI 候选不使用'
                        : seg.language === 'unknown' && isDigitLikeAlignableScript(seg.text)
                          ? '纯数字（无汉字）可与假 AI 英文流一并顺序消费；重新导入后将标为 EN'
                          : '假 AI 对齐不使用此类片段'
                  }
                  onClick={() => selectSegment(isSelected ? null : seg.id)}
                >
                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <span className="type-nav-id tabular-nums">#{String(displayIndex).padStart(3, '0')}</span>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      <span className={languageBadgeClass(seg.language)}>{languageBadgeLabel(seg.language)}</span>
                      {seg.language === 'chinese' || seg.language === 'mixed' ? (
                        <span className="script-pool-context-tag" title="仅作上下文，不进入 DeepSeek 英文候选池">
                          上下文
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="type-caption text-meta mt-0.5 block text-left">L{seg.sourceLine}</span>
                  <span className="script-pool-item__text mt-1 block text-left leading-snug text-[var(--color-text-primary)]">
                    {shortPreview(seg.text)}
                  </span>
                </button>
                {alignPoolIdx != null ? (
                  <div className="flex justify-end border-t border-[var(--color-border-subtle)] px-2 py-1.5">
                    <button
                      type="button"
                      className="toolbar-btn text-[11px]"
                      title="将英文池游标设为本段在「纯英文池」中的下标，用于整文件对齐 / drift 恢复"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEnglishCursor(alignPoolIdx)
                      }}
                    >
                      设为对齐游标 · pool[{alignPoolIdx}]
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
