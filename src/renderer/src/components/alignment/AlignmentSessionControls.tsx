import type { JSX } from 'react'
import {
  pauseAlignmentSession,
  resumeAlignmentSession,
  stopAlignmentSession
} from '../../lib/alignment'
import {
  isAlignmentSessionActive,
  useAlignmentSessionStore
} from '../../store/alignmentSessionStore'

export function AlignmentSessionControls({
  compact = false,
  className = ''
}: {
  compact?: boolean
  className?: string
}): JSX.Element | null {
  const sessionStatus = useAlignmentSessionStore((s) => s.status)

  if (!isAlignmentSessionActive(sessionStatus)) return null

  return (
    <div
      className={`alignment-session-controls flex flex-wrap items-center gap-2${className ? ` ${className}` : ''}`}
      role="toolbar"
      aria-label="整文件对齐控制"
    >
      {sessionStatus === 'running' ? (
        <button
          type="button"
          className={`toolbar-btn toolbar-btn--panel${compact ? ' px-2 py-1 text-[11px]' : ' text-[12px]'}`}
          onClick={() => pauseAlignmentSession()}
        >
          暂停对齐
        </button>
      ) : null}
      {sessionStatus === 'paused' ? (
        <button
          type="button"
          className={`toolbar-btn toolbar-btn--panel${compact ? ' px-2 py-1 text-[11px]' : ' text-[12px]'}`}
          onClick={() => resumeAlignmentSession()}
        >
          继续对齐
        </button>
      ) : null}
      <button
        type="button"
        className={`toolbar-btn toolbar-btn--panel${compact ? ' px-2 py-1 text-[11px]' : ' text-[12px]'}`}
        onClick={() => {
          if (!window.confirm('停止整文件对齐？已写入的字幕将保留。')) return
          stopAlignmentSession()
        }}
      >
        停止整文件
      </button>
      {!compact ? (
        <p className="alignment-session-controls__hint type-caption w-full text-meta leading-snug">
          可随时暂停查看本批摘要；停止后已写入结果保留，可调整原稿后重跑。
        </p>
      ) : null}
    </div>
  )
}
