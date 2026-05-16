import type { SubtitleLine } from '../../types'

export interface WideRetrySuggestion {
  /** 是否展示「建议尝试扩窗重试」类提示（不自动执行）。 */
  suggest: boolean
  /** 简短理由，供 UI 展示。 */
  reasons: string[]
}

function dedupeReasons(reasons: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of reasons) {
    const t = r.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/**
 * Phase 4B：在何种情况下「建议」用户考虑 Wide Retry（更大英文上下文 tier）。
 * 仅只读推断，不触发任何对齐或写 store。
 */
export function computeWideRetrySuggestion(input: {
  line: SubtitleLine
  dupIds: Map<string, boolean>
  confidenceThresholdPct: number
}): WideRetrySuggestion {
  const { line, dupIds, confidenceThresholdPct } = input
  const reasons: string[] = []

  if (!line.english.trim()) {
    reasons.push('当前英文为空')
  }

  for (const [, isDup] of dupIds) {
    if (isDup) {
      reasons.push('存在 duplicate 尝试键')
      break
    }
  }

  for (const p of line.problems) {
    if (p.includes('span_overlap')) {
      reasons.push('存在 span 重叠')
    }
    if (p.includes('no_match_after_retry')) {
      reasons.push('重试后仍无匹配')
    }
    if (p.includes('no_match')) {
      reasons.push('问题含无匹配')
    }
  }

  if (line.english.trim() && line.confidence < confidenceThresholdPct) {
    reasons.push('置信低于阈值')
  }

  const attempts = line.aiAttempts ?? []
  const recentFails = attempts
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 4)
    .filter((a) => !a.english.trim()).length
  if (recentFails >= 2) {
    reasons.push('近期多次失败尝试')
  }

  const deduped = dedupeReasons(reasons, 4)
  return {
    suggest: deduped.length > 0,
    reasons: deduped
  }
}
