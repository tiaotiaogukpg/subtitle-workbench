import type { SubtitleAiAttempt, SubtitleLine } from '../../types'

/**
 * Phase 4A — Alignment Intelligence：风险模型与全文件复查队列。
 *
 * 原则：仅用于排序、提示与 UI；不触发自动对齐、不写 subtitle、不 apply attempts、不发起 retry。
 * 队列由当前 `SubtitleLine[]` 派生（全文件 persistent 语义 = 与字幕数据同源，非临时 batch 列表）。
 *
 * 与 Coverage Pass 的 `isRetryCoverageTarget` 区分：后者只约束自动重试批；本队列只服务人工复查导航。
 */

export type AlignmentRiskBand = 'low' | 'elevated' | 'high'

export interface AlignmentRiskAssessment {
  /** 越大越应优先人工查看；与业务规则绑定，非概率。 */
  score: number
  band: AlignmentRiskBand
  /** 简短中文提示，供面板展示（已去重、截断）。 */
  hints: string[]
}

const CJK_IN_ENGLISH = /[\u4e00-\u9fff]/

function dedupeHints(hints: string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const h of hints) {
    const t = h.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/**
 * 全文件复查队列成员判定（Phase 4A 唯一入口）。
 * 与导航、侧栏标记、后续 batch UX 共用，避免与「当前 batch」耦合。
 */
export function isInAlignmentReviewQueue(
  line: SubtitleLine,
  _options?: { confidenceThresholdPct?: number }
): boolean {
  if (line.status === 'needs_review') return true
  if (line.status === 'low_confidence') return true
  if (line.status === 'unmatched') return true
  if (line.status === 'manual') {
    if (!line.english.trim()) return true
    if (line.problems.length > 0) return true
  }
  return false
}

/**
 * 对齐风险评分：只读；不修改字幕、不写 store。
 */
export function computeAlignmentRisk(
  line: SubtitleLine,
  options?: { confidenceThresholdPct?: number }
): AlignmentRiskAssessment {
  const thr = options?.confidenceThresholdPct ?? 60
  let score = 0
  const hints: string[] = []

  switch (line.status) {
    case 'needs_review':
      score += 200
      hints.push('状态：需复查')
      break
    case 'low_confidence':
      score += 120
      hints.push('状态：低置信')
      break
    case 'unmatched':
      score += 85
      hints.push('状态：未匹配')
      break
    case 'manual':
      score += 38
      hints.push('状态：已手改')
      break
    default:
      break
  }

  if (!line.english.trim()) {
    score += 72
    hints.push('英文为空')
  } else if (CJK_IN_ENGLISH.test(line.english)) {
    score += 48
    hints.push('英文含汉字')
  }

  const nProb = line.problems.length
  score += Math.min(110, nProb * 14)
  if (nProb >= 3) hints.push(`问题项较多（${nProb}）`)

  for (const p of line.problems) {
    if (p.includes('semantic_undersegmentation')) {
      score += 30
      hints.push('语义分段不足')
    } else if (p.includes('span_overlap')) {
      score += 22
      hints.push('span 重叠')
    } else if (p.includes('no_match_after_retry')) {
      score += 26
      hints.push('扩窗后仍无匹配')
    } else if (p.includes('no_match')) {
      score += 18
      hints.push('无匹配记录')
    }
  }

  const failAttempts = (line.aiAttempts ?? []).filter((a) => !a.english.trim()).length
  score += Math.min(48, failAttempts * 16)
  if (failAttempts > 0) hints.push(`失败 AI 尝试 ${failAttempts} 次`)

  if (line.english.trim() && line.confidence < thr) {
    score += Math.round((thr - line.confidence) * 0.55)
    if (line.status !== 'low_confidence') hints.push('置信低于阈值')
  }

  const scoreClamped = Math.min(999, Math.round(score))
  const band: AlignmentRiskBand =
    scoreClamped >= 280 ? 'high' : scoreClamped >= 145 ? 'elevated' : 'low'

  return {
    score: scoreClamped,
    band,
    hints: dedupeHints(hints, 6)
  }
}

export interface ReviewQueueEntry {
  line: SubtitleLine
  risk: AlignmentRiskAssessment
}

/**
 * 全文件复查队列：由当前字幕表派生，按风险分降序、行号升序；非临时 batch 列表。
 */
export function buildGlobalReviewQueue(
  subtitles: SubtitleLine[],
  options?: { confidenceThresholdPct?: number }
): ReviewQueueEntry[] {
  const thr = options?.confidenceThresholdPct ?? 60
  const entries: ReviewQueueEntry[] = []
  for (const line of subtitles) {
    if (!isInAlignmentReviewQueue(line, { confidenceThresholdPct: thr })) continue
    entries.push({ line, risk: computeAlignmentRisk(line, { confidenceThresholdPct: thr }) })
  }
  entries.sort((a, b) => {
    if (b.risk.score !== a.risk.score) return b.risk.score - a.risk.score
    return a.line.id - b.line.id
  })
  return entries
}

/** 在有序队列 id 列表上步进（环形）；用于上一条/下一条复查导航。 */
export function advanceReviewQueueId(
  orderedIds: number[],
  currentId: number | null,
  direction: 1 | -1
): number | null {
  if (orderedIds.length === 0) return null
  if (currentId == null) return orderedIds[0] ?? null
  const idx = orderedIds.indexOf(currentId)
  if (idx < 0) return orderedIds[0] ?? null
  const j = (idx + direction + orderedIds.length) % orderedIds.length
  return orderedIds[j] ?? null
}

/** 单条 AI attempt 的注意度（非整行对齐风险）；仅 UI。 */
export function attemptAttentionBand(att: SubtitleAiAttempt): AlignmentRiskBand {
  if (!att.english.trim()) return 'high'
  if (att.problems.length >= 3) return 'high'
  if (att.problems.length >= 1) return 'elevated'
  if (att.confidence < 55) return 'elevated'
  return 'low'
}
