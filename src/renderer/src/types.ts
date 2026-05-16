export type SubtitleStatus = 'confirmed' | 'low_confidence' | 'manual' | 'unmatched' | 'needs_review'

/** 单行/整批 AI 对齐的一次尝试记录（`english` 为已应用结果时仍保留历史）。 */
export type SubtitleAiAttemptSource =
  | 'initial'
  | 'retry'
  | 'single_retry'
  | 'wide_retry'
  | 'batch_retry'
  | 'batch_wide_retry'

export interface SubtitleAiAttempt {
  id: string
  createdAt: number
  source: SubtitleAiAttemptSource
  english: string
  /** 与 `SubtitleLine.confidence` 一致：0–100 整数百分比。 */
  confidence: number
  problems: string[]
  /** 模型在当次上下文内的局部 span（不同批次窗口不可横向比较）。 */
  spanStart?: number
  spanEnd?: number
  /** 与 Script Pool 串联串对齐的全局 span；存在时可与邻行比较重叠。 */
  globalSpanStart?: number
  globalSpanEnd?: number
  contextTier?: number
  reason?: string
  /** 应用该尝试时写入的片段 id（可选，失败尝试通常为空）。 */
  matchedSegmentIds?: string[]
  /** 写入该行时应对应的状态（与整批策略一致）；缺失时由 UI 按置信度阈值回推。 */
  resultStatus?: SubtitleStatus
}

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
  /** 用户标记的偏好尝试 id（仅 UI / 防误删；不自动应用）。 */
  preferredAttemptId?: string
  /** 该行历次 AI 对齐尝试（仅追加；应用某条由用户显式触发）。 */
  aiAttempts?: SubtitleAiAttempt[]
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

/** AI Alignment 工作流中的运行参数（仅真实 DeepSeek · 整文件）。 */
export interface AiAlignmentRunConfig {
  model: string
  batchSize: number
  confidenceThreshold: number
}
