export type SubtitleStatus = 'confirmed' | 'low_confidence' | 'manual' | 'unmatched'

export interface CandidateMatch {
  id: string
  text: string
  confidence: number
}

export interface SubtitleLine {
  id: number
  start: number
  end: number
  chinese: string
  english: string
  confidence: number
  status: SubtitleStatus
  candidates: CandidateMatch[]
  problems: string[]
  manuallyEdited: boolean
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
