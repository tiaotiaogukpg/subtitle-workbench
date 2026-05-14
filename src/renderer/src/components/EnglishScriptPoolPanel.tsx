import { useMemo, type JSX } from 'react'
import type { ScriptPoolListFilter, ScriptSegmentLanguage } from '../types'
import { filterScriptSegmentsForList, useScriptPoolStore } from '../store/scriptPoolStore'

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

  const visible = useMemo(() => filterScriptSegmentsForList(segments, listFilter), [segments, listFilter])

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

            return (
              <button
                key={seg.id}
                type="button"
                className={`script-pool-item${isSelected ? ' script-pool-item--selected' : ''}`}
                title={seg.used ? '默认参与英文对齐候选池' : '保留为上下文，默认不参与英文候选'}
                onClick={() => selectSegment(isSelected ? null : seg.id)}
              >
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <span className="type-nav-id tabular-nums">#{String(displayIndex).padStart(3, '0')}</span>
                  <span className={languageBadgeClass(seg.language)}>{languageBadgeLabel(seg.language)}</span>
                </div>
                <span className="type-caption text-meta mt-0.5 block text-left">L{seg.sourceLine}</span>
                <span className="script-pool-item__text mt-1 block text-left leading-snug text-[var(--color-text-primary)]">
                  {shortPreview(seg.text)}
                </span>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
