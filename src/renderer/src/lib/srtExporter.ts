import type { SubtitleLine } from '../types'

export const BILINGUAL_SRT_FILENAME = 'bilingual-subtitles.srt'

export type BilingualSubtitleOrder = 'chineseFirst' | 'englishFirst'

export interface ExportBilingualSrtOptions {
  subtitleOrder: BilingualSubtitleOrder
  separateLines: boolean
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 毫秒 → `HH:MM:SS,mmm`（SRT 逗号毫秒） */
function msToSrtTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms))
  const h = Math.floor(clamped / 3_600_000)
  const m = Math.floor((clamped % 3_600_000) / 60_000)
  const s = Math.floor((clamped % 60_000) / 1000)
  const milli = clamped % 1000
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(milli).padStart(3, '0')}`
}

/**
 * 合并一条 cue 的中英文正文；缺英文时只返回中文（或仅英文时只返回英文）。
 * `separateLines === false` 且两侧均无内部换行时，用空格拼接为单行；否则仍用换行分隔语种块以保留多行。
 */
function buildBilingualCueBody(
  chinese: string,
  english: string,
  subtitleOrder: BilingualSubtitleOrder,
  separateLines: boolean
): string {
  const zhRaw = chinese ?? ''
  const enTrimmed = (english ?? '').trim()
  const enRaw = enTrimmed ? (english ?? '') : ''

  const zhOnly = !zhRaw.trim() && !enRaw
  if (zhOnly) return ''

  if (!zhRaw.trim()) return enRaw.trimEnd()
  if (!enRaw) return zhRaw.trimEnd()

  const first = subtitleOrder === 'chineseFirst' ? zhRaw : enRaw
  const second = subtitleOrder === 'chineseFirst' ? enRaw : zhRaw
  const a = first.trimEnd()
  const b = second.trimStart()

  if (!separateLines && !a.includes('\n') && !b.includes('\n')) {
    return `${a} ${b}`
  }
  return `${a}\n${b}`
}

/**
 * 将字幕导出为双语 SRT 文本（UTF-8 字符串，不含 BOM）。
 */
export function exportBilingualSrt(subtitles: SubtitleLine[], options: ExportBilingualSrtOptions): string {
  const { subtitleOrder, separateLines } = options
  const blocks: string[] = []
  let index = 1

  for (const line of subtitles) {
    const body = buildBilingualCueBody(line.chinese, line.english, subtitleOrder, separateLines)
    if (!body) continue

    const start = msToSrtTimestamp(line.start)
    const end = msToSrtTimestamp(line.end)
    blocks.push(`${index++}\n${start} --> ${end}\n${body}`)
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : ''
}

/** 浏览器内触发下载双语 SRT（固定默认文件名）。 */
export function downloadBilingualSrt(subtitles: SubtitleLine[], options: ExportBilingualSrtOptions): void {
  const text = exportBilingualSrt(subtitles, options)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = BILINGUAL_SRT_FILENAME
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
