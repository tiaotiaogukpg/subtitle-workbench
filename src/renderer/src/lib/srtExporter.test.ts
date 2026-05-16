import { describe, expect, it } from 'vitest'
import type { SubtitleLine } from '../types'
import {
  buildSrtExportFilename,
  composeCueBodyForExport,
  exportSrt,
  type ExportSrtOptions
} from './srtExporter'

const baseOptions: ExportSrtOptions = {
  subtitleOrder: 'chineseFirst',
  separateLines: true
}

function line(partial: Partial<SubtitleLine> & Pick<SubtitleLine, 'id' | 'start' | 'end'>): SubtitleLine {
  return {
    chinese: '',
    english: '',
    confidence: 0,
    status: 'unmatched',
    candidates: [],
    problems: [],
    manuallyEdited: false,
    matchedSegmentIds: [],
    ...partial
  }
}

describe('composeCueBodyForExport', () => {
  it('bilingual：中文在上、英文在下', () => {
    const { body, include } = composeCueBodyForExport(
      line({ id: 1, start: 0, end: 1000, chinese: '你好', english: 'Hello' }),
      { ...baseOptions, exportMode: 'bilingual' }
    )
    expect(include).toBe(true)
    expect(body).toBe('你好\nHello')
  })

  it('chinese_only：仅中文', () => {
    const { body, include } = composeCueBodyForExport(
      line({ id: 1, start: 0, end: 1000, chinese: '你好', english: 'Hello' }),
      { ...baseOptions, exportMode: 'chinese_only' }
    )
    expect(include).toBe(true)
    expect(body).toBe('你好')
  })

  it('english_only：仅英文', () => {
    const { body, include } = composeCueBodyForExport(
      line({ id: 1, start: 0, end: 1000, chinese: '你好', english: 'Hello' }),
      { ...baseOptions, exportMode: 'english_only' }
    )
    expect(include).toBe(true)
    expect(body).toBe('Hello')
  })

  it('english_only：默认跳过空英文', () => {
    const { include } = composeCueBodyForExport(
      line({ id: 1, start: 0, end: 1000, chinese: '你好', english: '   ' }),
      { ...baseOptions, exportMode: 'english_only' }
    )
    expect(include).toBe(false)
  })

  it('english_only：关闭 skip 时保留空时间轴', () => {
    const { body, include } = composeCueBodyForExport(
      line({ id: 1, start: 0, end: 1000, chinese: '你好', english: '' }),
      { ...baseOptions, exportMode: 'english_only', skipEmptyEnglishLines: false }
    )
    expect(include).toBe(true)
    expect(body).toBe('')
  })
})

describe('exportSrt', () => {
  const sample = [
    line({ id: 1, start: 1000, end: 2000, chinese: '甲', english: 'A' }),
    line({ id: 2, start: 3000, end: 4000, chinese: '乙', english: '' }),
    line({ id: 3, start: 5000, end: 6000, chinese: '丙', english: 'C' })
  ]

  it('english_only 跳过空英文后序号连续', () => {
    const text = exportSrt(sample, { ...baseOptions, exportMode: 'english_only' })
    expect(text).toContain('1\n00:00:01,000 --> 00:00:02,000\nA')
    expect(text).toContain('2\n00:00:05,000 --> 00:00:06,000\nC')
    expect(text).not.toContain('00:00:03,000')
    expect(text.match(/^2\n/m)).not.toBeNull()
  })

  it('english_only 不跳过时保留中间空轴', () => {
    const text = exportSrt(sample, {
      ...baseOptions,
      exportMode: 'english_only',
      skipEmptyEnglishLines: false
    })
    expect(text).toMatch(/2\n00:00:03,000 --> 00:00:04,000\n\n\n3\n/)
  })

  it('chinese_only 不含英文', () => {
    const text = exportSrt(sample, { ...baseOptions, exportMode: 'chinese_only' })
    expect(text).not.toContain('A\n')
    expect(text).toContain('甲')
    expect(text).not.toContain('C\n')
    expect(text).toContain('丙')
  })
})

describe('buildSrtExportFilename', () => {
  it('生成各模式推荐文件名', () => {
    expect(buildSrtExportFilename('bilingual', 'demo')).toBe('demo.bilingual.srt')
    expect(buildSrtExportFilename('chinese_only', 'demo')).toBe('demo.zh.srt')
    expect(buildSrtExportFilename('english_only', 'demo')).toBe('demo.en.srt')
  })

  it('剥离已有 .srt 后缀', () => {
    expect(buildSrtExportFilename('english_only', 'clip.srt')).toBe('clip.en.srt')
  })
})
