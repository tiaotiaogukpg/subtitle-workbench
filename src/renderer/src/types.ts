export type SubtitleStatus = 'confirmed' | 'low_confidence' | 'manual' | 'unmatched' | 'needs_review'

export interface CandidateMatch {
  id: string
  /** 该候选合并自哪些英文原稿片段（连续片段 id）。 */
  segmentIds: string[]
  /** 对齐来源：当前仅由 DeepSeek 写入。 */
  source?: 'ai'
  /** `segmentIds` 对应片段文本以空格合并后的展示串。 */
  text: string
  confidence: number
  /** 对齐候选组 id（DeepSeek group 匹配）。 */
  groupId?: string
}

/** 连续纯英文 Script Pool 片段组成的 DeepSeek 候选组。 */
export interface CandidateSegmentGroup {
  id: string
  segmentIds: string[]
  text: string
  startSegmentIndex: number
  endSegmentIndex: number
  wordCount: number
  charCount: number
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
  /** 当前行英文对齐所绑定的 Script Pool 片段 id（预留 / 与候选一致）。 */
  matchedSegmentIds: string[]
}

export type ScriptSegmentLanguage = 'english' | 'chinese' | 'mixed' | 'unknown'

/**
 * 混合原稿解析后的脚本片段（与字幕时间轴独立）。
 * `used`：是否默认参与后续英文对齐候选池（english / mixed 为 true，chinese / unknown 为 false）。
 */
export interface ScriptSegment {
  id: string
  text: string
  language: ScriptSegmentLanguage
  sourceLine: number
  used: boolean
}

/** Script Pool 列表筛选（不改变 store 中的全量 segments）。 */
export type ScriptPoolListFilter = 'all' | 'english' | 'mixed' | 'chinese'

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

export type AiAlignmentMode = 'batch_test' | 'full_file'

/** AI Alignment 工作流中的运行参数（仅真实 DeepSeek）。 */
export interface AiAlignmentRunConfig {
  model: string
  batchSize: number
  confidenceThreshold: number
  mode: AiAlignmentMode
}
