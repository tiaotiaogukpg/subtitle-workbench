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

  const visible = useMemo(() => filterScriptSegmentsForList(segments, listFilter), [segments, listFilter])

  return (
    <aside className="app-panel script-pool-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="app-panel-header script-pool-panel__head shrink-0 px-3 py-2">
        <h2 className="ui-section-title">英文原稿</h2>
        <p className="type-caption script-pool-panel__caption mt-0.5">
          Script pool · {segments.length} 条
          {listFilter !== 'all' ? ` · 显示 ${visible.length}` : ''}
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

      <div className="script-pool-panel__scroll min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2">
        {segments.length === 0 ? (
          <div className="type-caption script-pool-empty rounded-lg border border-dashed px-3 py-6 text-center leading-relaxed">
            暂无原稿脚本
            <span className="script-pool-empty__hint mt-1 block">使用工具栏「导入英文文稿」载入 .txt（支持中英混排、说话人行等）</span>
          </div>
        ) : visible.length === 0 ? (
          <div className="type-caption script-pool-empty rounded-lg border border-dashed px-3 py-6 text-center leading-relaxed">
            当前筛选下无条目
            <span className="script-pool-empty__hint mt-1 block">请切换筛选或导入其它内容</span>
          </div>
        ) : (
          visible.map((seg, index) => {
            const displayIndex = index + 1
            const isSelected = seg.id === selectedSegmentId

            const isDimmed = seg.language === 'english' && !seg.used

            return (
              <div
                key={seg.id}
                className={`script-pool-item${isSelected ? ' script-pool-item--selected' : ''}${isDimmed ? ' script-pool-item--dim' : ''}`}
              >
                <button
                  type="button"
                  className="script-pool-item__hit"
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
                  <span className="type-caption script-pool-item__line-no mt-0.5 block text-left">L{seg.sourceLine}</span>
                  <span className="script-pool-item__text mt-1 block text-left leading-snug">
                    {shortPreview(seg.text)}
                  </span>
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
