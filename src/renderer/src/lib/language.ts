/** 文本语言检测：DeepSeek 英文候选池共用。 */

const CJK_BASIC = /[\u4e00-\u9fff]/

function stripEmojiBlocks(s: string): string {
  try {
    return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\uFE0F/g, '').replace(/\u200D/g, '')
  } catch {
    return s.replace(/\uFE0F/g, '').replace(/\u200D/g, '')
  }
}

export function containsChinese(text: string): boolean {
  return CJK_BASIC.test(text)
}

export function isPureEnglishText(text: string): boolean {
  const raw = text.trim()
  if (raw.length === 0) return false
  if (containsChinese(raw)) return false

  const compact = stripEmojiBlocks(raw).replace(/\s+/g, '')
  if (compact.length === 0) return false

  const letters = (compact.match(/[a-zA-Z]/g) ?? []).length
  const ratio = letters / compact.length

  if (compact.length <= 6) {
    return letters >= 1 && ratio >= 0.34
  }
  return ratio >= 0.45
}
