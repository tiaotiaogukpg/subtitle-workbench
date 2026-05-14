import type { SubtitleLine } from '../types'

const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/

/**
 * 将 SRT 时间戳 `00:00:01,200` 或 `00:00:01.200` 转为毫秒。
 */
export function srtTimestampToMs(raw: string): number {
  const s = raw.trim().replace('.', ',')
  const m = s.match(TIME_RE)
  if (!m) throw new Error(`无效时间戳: "${raw}"`)
  const hh = Number(m[1])
  const mm = Number(m[2])
  const ss = Number(m[3])
  const ms = Number(m[4])
  if (mm > 59 || ss > 59) throw new Error(`时间分量越界: "${raw}"`)
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms
}

const CUE_HEADER =
  /^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/

function blankLine(line: string): boolean {
  return line.trim() === ''
}

/**
 * 解析标准 SRT 文本为 `SubtitleLine[]`。
 * 多行字幕正文以 `\n` 连接保留。
 *
 * @throws Error 格式无法识别时抛出（由调用方捕获并提示用户）
 */
export function parseSrt(content: string): SubtitleLine[] {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n')
  const out: SubtitleLine[] = []
  let i = 0

  while (i < lines.length) {
    while (i < lines.length && blankLine(lines[i]!)) i++
    if (i >= lines.length) break

    let line = lines[i]!
    if (/^\d+$/.test(line.trim())) {
      i++
      if (i >= lines.length) break
      line = lines[i]!
    }

    const cueMatch = line.trim().match(CUE_HEADER)
    if (!cueMatch) {
      throw new Error(`第 ${out.length + 1} 条附近：缺少有效时间轴行（期望 00:00:00,000 --> 00:00:00,000）`)
    }

    const start = srtTimestampToMs(cueMatch[1]!)
    const end = srtTimestampToMs(cueMatch[2]!)
    i++

    const textLines: string[] = []
    while (i < lines.length && !blankLine(lines[i]!)) {
      textLines.push(lines[i]!)
      i++
    }
    while (i < lines.length && blankLine(lines[i]!)) i++

    const chinese = textLines.join('\n').replace(/\u00a0/g, ' ').trimEnd()

    const id = out.length + 1
    out.push({
      id,
      start,
      end,
      chinese,
      english: '',
      confidence: 0,
      status: 'unmatched',
      candidates: [],
      problems: [],
      manuallyEdited: false,
      matchedSegmentIds: []
    })
  }

  if (out.length === 0) {
    throw new Error('未解析到任何字幕块，请确认文件为 SRT 格式')
  }

  return out
}
