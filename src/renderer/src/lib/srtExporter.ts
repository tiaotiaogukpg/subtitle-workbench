import type { SubtitleLine } from '../types'

/** @deprecated 使用 {@link buildSrtExportFilename}（`exportMode: 'bilingual'`） */
export const BILINGUAL_SRT_FILENAME = 'bilingual-subtitles.srt'

export type ExportMode = 'bilingual' | 'chinese_only' | 'english_only'

export type BilingualSubtitleOrder = 'chineseFirst' | 'englishFirst'

export interface ExportSrtOptions {
  exportMode?: ExportMode
  subtitleOrder: BilingualSubtitleOrder
  separateLines: boolean
  /** 仅 `english_only` 时生效；默认跳过英文为空的整条字幕 */
  skipEmptyEnglishLines?: boolean
  /** 不含扩展名；默认 `subtitles` */
  baseFilename?: string
}

/** @deprecated 使用 {@link ExportSrtOptions} */
export type ExportBilingualSrtOptions = ExportSrtOptions

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

export interface ComposeCueResult {
  body: string
  include: boolean
}

/**
 * 按导出模式合成单条 cue 正文；`include === false` 时不写入该时间轴。
 */
export function composeCueBodyForExport(line: SubtitleLine, options: ExportSrtOptions): ComposeCueResult {
  const exportMode = options.exportMode ?? 'bilingual'
  const skipEmptyEnglishLines = options.skipEmptyEnglishLines ?? true
  const zhRaw = line.chinese ?? ''
  const enRaw = line.english ?? ''

  if (exportMode === 'bilingual') {
    const body = buildBilingualCueBody(zhRaw, enRaw, options.subtitleOrder, options.separateLines)
    return { body, include: body.length > 0 }
  }

  if (exportMode === 'chinese_only') {
    const body = zhRaw.trimEnd()
    return { body, include: body.trim().length > 0 }
  }

  const enTrimmed = enRaw.trim()
  if (enTrimmed.length === 0) {
    if (skipEmptyEnglishLines) {
      return { body: '', include: false }
    }
    return { body: '', include: true }
  }

  return { body: enRaw.trimEnd(), include: true }
}

/** 根据导出模式生成推荐下载文件名。 */
export function buildSrtExportFilename(exportMode: ExportMode, baseFilename = 'subtitles'): string {
  const base = baseFilename
    .replace(/\.srt$/i, '')
    .replace(/\.(bilingual|en|zh)$/i, '')
    .trim() || 'subtitles'

  switch (exportMode) {
    case 'bilingual':
      return `${base}.bilingual.srt`
    case 'chinese_only':
      return `${base}.zh.srt`
    case 'english_only':
      return `${base}.en.srt`
  }
}

/**
 * 将字幕导出为 SRT 文本（UTF-8 字符串，不含 BOM）。
 */
export function exportSrt(subtitles: SubtitleLine[], options: ExportSrtOptions): string {
  const blocks: string[] = []
  let index = 1

  for (const line of subtitles) {
    const { body, include } = composeCueBodyForExport(line, options)
    if (!include) continue

    const start = msToSrtTimestamp(line.start)
    const end = msToSrtTimestamp(line.end)
    blocks.push(`${index++}\n${start} --> ${end}\n${body}`)
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : ''
}

/**
 * 将字幕导出为双语 SRT 文本（UTF-8 字符串，不含 BOM）。
 * @deprecated 使用 {@link exportSrt}（默认或显式 `exportMode: 'bilingual'`）
 */
export function exportBilingualSrt(subtitles: SubtitleLine[], options: ExportSrtOptions): string {
  return exportSrt(subtitles, { ...options, exportMode: 'bilingual' })
}

/** 浏览器内触发 SRT 下载。 */
export function downloadSrt(subtitles: SubtitleLine[], options: ExportSrtOptions): void {
  const exportMode = options.exportMode ?? 'bilingual'
  const text = exportSrt(subtitles, options)
  const filename = buildSrtExportFilename(exportMode, options.baseFilename ?? 'subtitles')
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 浏览器内触发下载双语 SRT。 */
export function downloadBilingualSrt(subtitles: SubtitleLine[], options: ExportSrtOptions): void {
  downloadSrt(subtitles, { ...options, exportMode: 'bilingual' })
}
