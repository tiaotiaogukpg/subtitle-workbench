export type SubtitleStatus = 'confirmed' | 'lowConfidence' | 'manuallyEdited' | 'unmatched'

export interface SubtitleLine {
  id: string
  index: number
  startMs: number
  endMs: number
  zh: string
  en: string
  confidence: number
  status: SubtitleStatus
  candidates: string[]
}

export interface SettingsState {
  provider: string
  apiKey: string
  model: string
  batchSize: number
  confidenceThreshold: number
  autoMarkHighConfidence: boolean
  subtitleOrder: 'chineseFirst' | 'englishFirst'
  exportFormat: '.srt'
  separateLines: boolean
  theme: 'light' | 'dark'
  fontSize: number
}
