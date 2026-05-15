/** 允许后一条 spanStart 略早于前一条的容差（字符），用于顺序子串定位与 order 诊断。 */
export const ORDER_SPAN_BACKTRACK_TOLERANCE = 12

/** 两 span 较短者上，重叠长度占比超过此阈值则标 duplicate_span（且非完全相同区间）。 */
export const SPAN_OVERLAP_DUPLICATE_RATIO = 0.45

/** 批内相邻字幕 span 重叠超过该比例则标 adjacent_span_heavy_overlap。 */
export const ADJACENT_SPAN_OVERLAP_RATIO = 0.45

/** 小批量对齐：每批中文字幕条数（默认，可被设置覆盖）。 */
export const SMALL_BATCH_SUBTITLE_COUNT = 5

/** Debug 候选组列表最多条目数（仅写入 prompt 的 englishCandidateGroupsDebug）。 */
export const DEBUG_CANDIDATE_GROUPS_MAX = 120

export const MAX_GROUP_SEGMENTS = 3
export const MAX_GROUP_WORDS = 20
export const MAX_GROUP_CHARS = 130
