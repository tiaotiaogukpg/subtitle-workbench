import { useEffect, useMemo, useState, type JSX } from 'react'
import { filterEnglishPoolSegments } from '../../lib/alignment/englishPool'
import type { ScriptSegment, SubtitleLine } from '../../types'

function shortExcerpt(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function oneLineSnippet(text: string, max: number): string {
  const s = shortExcerpt(text, max)
  return s || '—'
}

export interface ContextAssistFoldableProps {
  subtitles: SubtitleLine[]
  line: SubtitleLine
  segments: ScriptSegment[]
}

/** Phase 4B 内嵌：默认折叠的邻行 / Script Pool 辅助上下文。 */
export function ContextAssistFoldable({ subtitles, line, segments }: ContextAssistFoldableProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [line.id])

  const idx = subtitles.findIndex((l) => l.id === line.id)
  const prev = idx > 0 ? subtitles[idx - 1] : null
  const next = idx >= 0 && idx < subtitles.length - 1 ? subtitles[idx + 1]! : null

  const engPool = useMemo(() => filterEnglishPoolSegments(segments), [segments])

  const nearbyScript = useMemo(() => {
    if (engPool.length === 0) return '（无英文 Script Pool 片段）'
    let center = 0
    if (line.matchedSegmentIds?.length) {
      const hit = engPool.findIndex((s) => s.id === line.matchedSegmentIds![0])
      if (hit >= 0) center = hit
    } else if (subtitles.length > 0) {
      center = Math.min(
        engPool.length - 1,
        Math.max(0, Math.floor((line.id - 1) * (engPool.length / Math.max(1, subtitles.length))))
      )
    }
    const lo = Math.max(0, center - 2)
    const hi = Math.min(engPool.length, center + 4)
    return engPool
      .slice(lo, hi)
      .map((s) => `[${s.id}] ${shortExcerpt(s.text, 96)}`)
      .join('\n')
  }, [engPool, line.id, line.matchedSegmentIds, subtitles.length])

  const summary = useMemo(() => {
    const p = oneLineSnippet(prev?.english ?? '', 28)
    const c = oneLineSnippet(line.chinese, 24)
    const n = oneLineSnippet(next?.english ?? '', 28)
    return `Prev: ${p} · Cur: ${c} · Next: ${n}`
  }, [prev, next, line.chinese])

  return (
    <div className="context-assist-foldable mb-3" data-review-hotkeys="true">
      <div className="context-assist-foldable__bar">
        <div className="context-assist-foldable__summary-wrap">
          <span className="context-assist-foldable__label">上下文</span>
          <span className="context-assist-foldable__summary" title={summary}>
            {summary}
          </span>
        </div>
        <button
          type="button"
          className="context-assist-foldable__toggle ai-attempt-btn px-2 py-1 text-[11px] shrink-0"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? '收起' : '展开上下文'}
        </button>
      </div>
      {expanded ? (
        <div className="context-assist-foldable__detail">
          <div className="context-assist-foldable__block">
            <p className="context-assist-foldable__field">上一行 · English</p>
            <p className="context-assist-foldable__value">{prev?.english.trim() ? shortExcerpt(prev.english, 400) : '—'}</p>
          </div>
          <div className="context-assist-foldable__block">
            <p className="context-assist-foldable__field">当前 · Chinese</p>
            <p className="context-assist-foldable__value">{line.chinese.trim() ? shortExcerpt(line.chinese, 400) : '—'}</p>
          </div>
          <div className="context-assist-foldable__block">
            <p className="context-assist-foldable__field">下一行 · English</p>
            <p className="context-assist-foldable__value">{next?.english.trim() ? shortExcerpt(next.english, 400) : '—'}</p>
          </div>
          <div className="context-assist-foldable__block">
            <p className="context-assist-foldable__field">Script Pool 邻域</p>
            <pre className="context-assist-foldable__pre">{nearbyScript}</pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
