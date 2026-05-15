/**
 * DeepSeek 英文候选池：仅允许「纯英文」文本片段。
 * 与解析器 `language` 字段独立：即使标为 english，仍须通过 `isPureEnglishSegment`。
 */

/** 基本汉字平面（与需求一致）；不含扩展区，避免误伤罕见符号。 */
const CJK_BASIC = /[\u4e00-\u9fff]/

/** 去除 emoji（不参与字母比例）；不影响是否含中文的判断。 */
function stripEmojiBlocks(s: string): string {
  try {
    return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\uFE0F/g, '').replace(/\u200D/g, '')
  } catch {
    return s.replace(/\uFE0F/g, '').replace(/\u200D/g, '')
  }
}

export function hasChineseChars(text: string): boolean {
  return CJK_BASIC.test(text)
}

function latinLetterCount(s: string): number {
  return (s.match(/[a-zA-Z]/g) ?? []).length
}

/**
 * 英文字母占「有效字符」比例：排除空白；emoji 已从文本中剥离后再算。
 * 允许数字、常见英文标点、撇号；短行单独放宽。
 */
export function isPureEnglishSegment(text: string): boolean {
  const raw = text.trim()
  if (raw.length === 0) return false
  if (hasChineseChars(raw)) return false

  const noEmoji = stripEmojiBlocks(raw)
  const compact = noEmoji.replace(/\s+/g, '')
  if (compact.length === 0) return false

  const letters = latinLetterCount(compact)
  const ratio = letters / compact.length

  if (compact.length <= 6) {
    return letters >= 1 && ratio >= 0.34
  }
  return ratio >= 0.45
}

/** 用于 Script Pool：是否进入 DeepSeek 英文候选池（与 language 无关，仅看文本）。 */
export function isDeepSeekEnglishCandidateSegment(text: string): boolean {
  return isPureEnglishSegment(text)
}
