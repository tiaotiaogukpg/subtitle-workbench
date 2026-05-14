import type { Dispatch, SetStateAction } from 'react'
import { useScriptPoolStore } from '../store/scriptPoolStore'
import { useSubtitleStore } from '../store/subtitleStore'
import type {
  AlignmentSession,
  AlignmentWorkflowDraft,
  CandidateMatch,
  ScriptSegment,
  SubtitleLine,
  SubtitleStatus
} from '../types'

export interface SimulateAlignmentResult {
  cancel: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/**
 * 按原稿顺序抽出 `language === 'english'` 的片段（采访稿里中英交错，仅 EN 进入对齐游标）。
 */
function buildEnglishOnlySegmentsInOrder(segments: ScriptSegment[]): ScriptSegment[] {
  return segments.filter((s) => s.language === 'english' && s.text.trim().length > 0)
}

/** 去空白后的中文字符长度（假规则，非真实语义）。 */
function chineseNonSpaceLen(s: string): number {
  return s.replace(/\s/g, '').length
}

/**
 * 按中文长度「优先」合并段数，再受 primary 窗口与池尾约束；仍为随机假 AI。
 */
function pickPrimarySegmentCountFake(chLen: number, maxK: number): number {
  const cap = Math.max(1, Math.min(4, maxK))
  let pick = 1
  if (chLen <= 12) {
    pick = 1
  } else if (chLen <= 28) {
    pick = Math.random() < 0.62 ? 1 : 2
  } else if (chLen <= 45) {
    pick = Math.random() < 0.48 ? 2 : 3
  } else {
    pick = Math.random() < 0.42 ? 3 : 4
  }
  return Math.max(1, Math.min(pick, cap))
}

/** 从 `start` 起连续 `k` 条，且末段下标不超过 `maxEndIndex`（含）。 */
function sliceConsecutiveInEndCap(
  eng: ScriptSegment[],
  start: number,
  k: number,
  maxEndIndex: number
): ScriptSegment[] {
  const n = eng.length
  if (start < 0 || start >= n || k < 1) return []
  const end = Math.min(n - 1, start + k - 1, maxEndIndex)
  if (end < start) return []
  return eng.slice(start, end + 1)
}

function statusFromTopConfidence(confidencePct: number): SubtitleStatus {
  if (confidencePct > 90) return 'confirmed'
  if (confidencePct >= 60) return 'low_confidence'
  return 'unmatched'
}

function mergeConsecutiveSegments(run: ScriptSegment[]): { text: string; segmentIds: string[] } {
  const text = run
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
  const segmentIds = run.map((s) => s.id)
  return { text, segmentIds }
}

function makeCandidateFromRun(run: ScriptSegment[], confidence: number): CandidateMatch {
  const { text, segmentIds } = mergeConsecutiveSegments(run)
  return {
    id: crypto.randomUUID(),
    segmentIds,
    text,
    confidence
  }
}

function buildProblems(params: {
  topConfidence: number
  threshold: number
  englishLen: number
  candidateCount: number
  topSegmentCount: number
}): string[] {
  const out: string[] = []
  if (params.topConfidence < params.threshold) {
    out.push('置信度低于对齐阈值')
  }
  if (params.englishLen > 220) {
    out.push('英文译稿过长')
  }
  if (params.candidateCount === 0) {
    out.push('无可用候选')
  }
  if (params.topSegmentCount >= 3) {
    out.push('Candidate may be too long')
  }
  return out
}

function candidateKey(c: CandidateMatch): string {
  return `${c.segmentIds.join('|')}::${c.text}`
}

const PRIMARY_WINDOW_END_OFFSET = 4
const FALLBACK_WINDOW_END_OFFSET = 8

/**
 * 顺序窗口匹配（假 AI）：
 * - `englishCursor`（下标）起，主窗口 [c, c+4]、回退窗口 [c, c+8] 内仅连续 EN 段合并。
 * - 主候选写入字幕；游标按主候选段数推进；无有效主候选时游标最多 +1。
 */
function buildCandidatesForLine(
  line: SubtitleLine,
  englishOnly: ScriptSegment[],
  cursor: { index: number }
): { candidates: CandidateMatch[]; top: CandidateMatch; advanceBy: number } {
  const n = englishOnly.length
  const c = cursor.index

  if (n === 0) {
    const zh = line.chinese.trim() || '（无中文）'
    const stub = `[EN placeholder] ${zh.slice(0, 80)}${zh.length > 80 ? '…' : ''}`
    const topConf = 28 + Math.floor(Math.random() * 28)
    const top: CandidateMatch = {
      id: crypto.randomUUID(),
      segmentIds: [],
      text: stub,
      confidence: topConf
    }
    const alt: CandidateMatch = {
      id: crypto.randomUUID(),
      segmentIds: [],
      text: `[EN placeholder] alt-${line.id}`,
      confidence: Math.max(5, topConf - 12 - Math.floor(Math.random() * 15))
    }
    return { candidates: [top, alt], top, advanceBy: 0 }
  }

  if (c >= n) {
    const stub = `[EN pool exhausted] ${line.chinese.trim().slice(0, 56)}${line.chinese.trim().length > 56 ? '…' : ''}`
    const topConf = 22 + Math.floor(Math.random() * 18)
    const top: CandidateMatch = { id: crypto.randomUUID(), segmentIds: [], text: stub, confidence: topConf }
    const alt: CandidateMatch = {
      id: crypto.randomUUID(),
      segmentIds: [],
      text: `[EN pool exhausted] #${line.id}`,
      confidence: Math.max(8, topConf - 10)
    }
    return { candidates: [top, alt], top, advanceBy: 0 }
  }

  const maxEndPrimary = Math.min(n - 1, c + PRIMARY_WINDOW_END_OFFSET)
  const maxPrimaryLen = Math.min(4, maxEndPrimary - c + 1)
  const chLen = chineseNonSpaceLen(line.chinese)
  const k1 = pickPrimarySegmentCountFake(chLen, maxPrimaryLen)

  const primaryRun = sliceConsecutiveInEndCap(englishOnly, c, k1, maxEndPrimary)
  if (primaryRun.length === 0) {
    const stub = `[EN placeholder] ${line.chinese.trim().slice(0, 60)}`
    const top: CandidateMatch = {
      id: crypto.randomUUID(),
      segmentIds: [],
      text: stub,
      confidence: 35
    }
    return { candidates: [top], top, advanceBy: 1 }
  }

  const jitter = () => Math.floor(Math.random() * 10) - 2
  const primaryConf = Math.min(97, Math.max(74, 84 + Math.floor(Math.random() * 10) + jitter()))
  const primary = makeCandidateFromRun(primaryRun, primaryConf)
  const advanceBy = primaryRun.length

  const candidates: CandidateMatch[] = [primary]
  const seen = new Set<string>([candidateKey(primary)])

  const maxEndFb = Math.min(n - 1, c + FALLBACK_WINDOW_END_OFFSET)

  const s2 = c + 1
  if (s2 < n && s2 <= maxEndFb) {
    const maxK2 = Math.min(3, maxEndFb - s2 + 1)
    if (maxK2 >= 1) {
      const k2 = 1 + Math.floor(Math.random() * maxK2)
      const run2 = sliceConsecutiveInEndCap(englishOnly, s2, k2, maxEndFb)
      if (run2.length > 0) {
        const c2 = makeCandidateFromRun(run2, Math.max(22, primaryConf - 7 - Math.floor(Math.random() * 8)))
        const k2b = candidateKey(c2)
        if (!seen.has(k2b)) {
          seen.add(k2b)
          candidates.push(c2)
        }
      }
    }
  }

  const s3 = c + 2
  if (s3 < n && s3 <= maxEndFb) {
    const maxK3 = Math.min(2, maxEndFb - s3 + 1)
    if (maxK3 >= 1) {
      const k3 = 1 + Math.floor(Math.random() * maxK3)
      const run3 = sliceConsecutiveInEndCap(englishOnly, s3, k3, maxEndFb)
      if (run3.length > 0) {
        const c3 = makeCandidateFromRun(run3, Math.max(16, primaryConf - 14 - Math.floor(Math.random() * 10)))
        const k3b = candidateKey(c3)
        if (!seen.has(k3b)) {
          seen.add(k3b)
          candidates.push(c3)
        }
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence)
  const top = primary
  return { candidates, top, advanceBy }
}

/**
 * 假 AI：顺序窗口匹配中英采访稿中的 **纯英文** 段，维护 `englishCursor`；
 * 不写回 mixed/chinese/unknown；不调用 DeepSeek。
 */
export function simulateAlignment(options: {
  draft: AlignmentWorkflowDraft
  setAlignmentSession: Dispatch<SetStateAction<AlignmentSession>>
}): SimulateAlignmentResult {
  let cancelled = false
  const cancel = (): void => {
    cancelled = true
  }

  void run()

  async function run(): Promise<void> {
    const { draft, setAlignmentSession } = options
    const list = useSubtitleStore.getState().subtitles
    const total = list.length
    const batchSize = Math.max(1, draft.batchSize)
    const batchTotal = Math.max(1, Math.ceil(total / batchSize))
    const threshold = draft.confidenceThreshold

    if (total === 0) {
      setAlignmentSession((prev) => ({
        ...prev,
        phase: 'idle',
        progressPct: 0,
        batchIndex: 0,
        batchTotal: 0,
        matched: 0,
        total: 0,
        processingSubtitleId: null
      }))
      return
    }

    const englishOnlySegments = buildEnglishOnlySegmentsInOrder(useScriptPoolStore.getState().segments)
    const englishCursor = { index: 0 }
    let matchedAcc = 0

    for (let i = 0; i < total; i++) {
      if (cancelled) {
        setAlignmentSession((prev) => ({
          ...prev,
          phase: 'idle',
          processingSubtitleId: null
        }))
        return
      }

      const line = useSubtitleStore.getState().subtitles[i]
      if (!line) break

      const batchIndex = Math.floor(i / batchSize) + 1
      const progressStart = Math.round((i / total) * 10000) / 100

      setAlignmentSession((prev) => ({
        ...prev,
        phase: 'aligning',
        batchIndex,
        batchTotal,
        total,
        batchSize,
        progressPct: progressStart,
        processingSubtitleId: line.id
      }))

      await sleep(300 + Math.random() * 500)
      if (cancelled) {
        setAlignmentSession((prev) => ({
          ...prev,
          phase: 'idle',
          processingSubtitleId: null
        }))
        return
      }

      const { candidates, top, advanceBy } = buildCandidatesForLine(line, englishOnlySegments, englishCursor)
      englishCursor.index += advanceBy
      englishCursor.index = Math.min(englishCursor.index, englishOnlySegments.length)

      const english = top.text
      const status = statusFromTopConfidence(top.confidence)
      if (status === 'confirmed' || status === 'low_confidence') matchedAcc += 1

      const problems = buildProblems({
        topConfidence: top.confidence,
        threshold,
        englishLen: english.length,
        candidateCount: candidates.length,
        topSegmentCount: top.segmentIds.length
      })

      useSubtitleStore.getState().updateSubtitle(line.id, {
        english,
        confidence: top.confidence,
        status,
        candidates,
        problems,
        manuallyEdited: false,
        matchedSegmentIds: top.segmentIds
      })

      if (top.segmentIds.length > 0) {
        useScriptPoolStore.getState().markEnglishSegmentsUsedByFakeAlignment(top.segmentIds)
      }

      const progressPct = Math.round(((i + 1) / total) * 10000) / 100

      setAlignmentSession((prev) => ({
        ...prev,
        phase: 'aligning',
        progressPct,
        batchIndex,
        batchTotal,
        matched: matchedAcc,
        total,
        batchSize,
        processingSubtitleId: line.id
      }))
    }

    if (cancelled) {
      setAlignmentSession((prev) => ({
        ...prev,
        phase: 'idle',
        processingSubtitleId: null
      }))
      return
    }

    setAlignmentSession((prev) => ({
      ...prev,
      phase: 'complete',
      progressPct: 100,
      batchIndex: batchTotal,
      batchTotal,
      matched: matchedAcc,
      total,
      batchSize,
      processingSubtitleId: null
    }))
  }

  return { cancel }
}
