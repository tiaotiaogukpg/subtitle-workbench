/**
 * @deprecated 请从 `lib/alignment` 导入。保留转发以兼容旧引用。
 */
export {
  SMALL_BATCH_SUBTITLE_COUNT as REAL_ALIGN_SUBTITLE_COUNT,
  pickSmallBatchSubtitles as pickAlignmentSubtitleBatch,
  filterEnglishPoolSegments,
  buildBatchAlignmentPrompt as buildAlignmentMessages,
  buildBatchAlignmentUserPayload as buildAlignmentUserPayload,
  parseAlignmentModelJson,
  confidenceToPercent,
  statusFromConfidencePct,
  type AlignmentPromptSubtitle,
  type BatchAlignmentPromptInput,
  type AlignmentMatchRow as DeepSeekAlignmentMatchRow,
  type AlignmentModelResponseShape as DeepSeekAlignmentResponseShape
} from './alignment'

/** @deprecated 单 segment 窗口；小批量请用 candidate groups + filterEnglishPoolSegments */
export function pickNearbyScriptSegments(): never {
  throw new Error('pickNearbyScriptSegments 已移除，请使用 alignment 模块的 buildCandidateGroups')
}
