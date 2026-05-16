/** 与 Script Pool / local context 拼接一致的空白规范化。 */
export function normalizeGroupText(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

export function normalizedContains(haystack: string, needle: string): boolean {
  const h = normalizeGroupText(haystack).toLowerCase()
  const n = normalizeGroupText(needle).toLowerCase()
  return n.length > 0 && h.includes(n)
}
