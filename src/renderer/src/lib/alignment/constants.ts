/** 小批量对齐：每批中文字幕条数。 */
export const SMALL_BATCH_SUBTITLE_COUNT = 5

/** 英文池游标起窗口长度（含起点），用于候选组生成；应覆盖 local context 宽度。 */
export const DEFAULT_GROUP_WINDOW = 36

/** 整文件每批后 english 游标单次最多推进的池下标步长（防错配时 cursor 飞太远）。 */
export const MAX_ENGLISH_CURSOR_ADVANCE_SEGMENTS = 14

/** 批内相邻字幕所选英文组之间，允许的池下标「空隙」上限（过大视为 segment_jump）。 */
export const MAX_SEGMENT_FORWARD_GAP = 16

export const MAX_GROUP_SEGMENTS = 5
export const MAX_GROUP_WORDS = 35
export const MAX_GROUP_CHARS = 220

/** Prompt 只读 local English context：游标起连续纯英文片段数。 */
export const LOCAL_ENGLISH_CONTEXT_MIN_SEGMENTS = 10
export const LOCAL_ENGLISH_CONTEXT_MAX_SEGMENTS = 20
