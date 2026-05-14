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

export type AlignmentSessionPhase = 'idle' | 'aligning' | 'complete'

export type AlignmentWorkflowMode = 'sequential' | 'semanticHybrid'

export type SemanticMatchStrength = 'low' | 'medium' | 'high'

export interface AlignmentSession {
  phase: AlignmentSessionPhase
  progressPct: number
  batchIndex: number
  batchTotal: number
  matched: number
  total: number
  batchSize: number
}

export interface AlignmentWorkflowDraft {
  model: string
  batchSize: number
  confidenceThreshold: number
  mode: AlignmentWorkflowMode
  semanticStrength: SemanticMatchStrength
  retryFailed: boolean
}
