import type { SubtitleLine } from '../../types'
import { SMALL_BATCH_SUBTITLE_COUNT } from './constants'

export function pickSmallBatchSubtitles(
  subtitles: SubtitleLine[],
  currentSubtitleId: number | null,
  count: number = SMALL_BATCH_SUBTITLE_COUNT
): SubtitleLine[] {
  if (subtitles.length === 0) return []
  const n = Math.min(Math.max(1, Math.floor(count)), 50)
  const idx =
    currentSubtitleId != null ? Math.max(0, subtitles.findIndex((l) => l.id === currentSubtitleId)) : 0
  const start = idx >= 0 ? idx : 0
  const out: SubtitleLine[] = []
  for (let i = 0; i < n && i < subtitles.length; i++) {
    out.push(subtitles[(start + i) % subtitles.length]!)
  }
  return out
}

/** 从固定下标起连续取批（整文件对齐用，不环绕）。 */
export function pickSubtitleBatchSlice(
  subtitles: SubtitleLine[],
  startIndex: number,
  count: number
): SubtitleLine[] {
  if (subtitles.length === 0) return []
  const start = Math.min(Math.max(0, startIndex), subtitles.length - 1)
  const n = Math.min(Math.max(1, Math.floor(count)), 50, subtitles.length - start)
  return subtitles.slice(start, start + n)
}
