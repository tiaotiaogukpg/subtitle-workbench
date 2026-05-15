import type { ScriptSegment, SubtitleLine, SubtitleStatus } from '../types'
import { hasChineseChars, isPureEnglishSegment } from './englishCandidateFilter'

export const REAL_ALIGN_SUBTITLE_COUNT = 5
export const REAL_ALIGN_SEGMENT_WINDOW = 32

export interface AlignmentPromptSubtitle {
  subtitleId: number
  orderIndex: number
  chinese: string
}

export interface AlignmentPromptSegment {
  segmentId: string
  orderIndex: number
  text: string
  language: string
}

export interface DeepSeekAlignmentMatchRow {
  subtitleId: number
  matchedSegmentIds: string[]
  english: string
  confidence: number
  reason: string
}

export type DeepSeekMatchValidationFlag = 'invalid_candidate' | 'invalid_segment_id'

export interface DeepSeekAlignmentMatchValidated extends DeepSeekAlignmentMatchRow {
  validationFlags: DeepSeekMatchValidationFlag[]
  applyable: boolean
}

export interface DeepSeekAlignmentResponseShape {
  matches: DeepSeekAlignmentMatchRow[]
}

/** 粗略 prompt token 估计（仅用于调试面板，非计费依据）。 */
export function estimatePromptTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function pickAlignmentSubtitleBatch(
  subtitles: SubtitleLine[],
  currentSubtitleId: number | null
): SubtitleLine[] {
  if (subtitles.length === 0) return []
  const idx =
    currentSubtitleId != null ? Math.max(0, subtitles.findIndex((l) => l.id === currentSubtitleId)) : 0
  const start = idx >= 0 ? idx : 0
  const out: SubtitleLine[] = []
  for (let i = 0; i < REAL_ALIGN_SUBTITLE_COUNT && i < subtitles.length; i++) {
    out.push(subtitles[(start + i) % subtitles.length]!)
  }
  return out
}

/** 仅 `language === "english"` 且 `isPureEnglishSegment(text)` 的片段进入 DeepSeek 候选（顺序保持与 Script Pool 一致）。 */
export function listDeepSeekEnglishOnlySegments(segments: ScriptSegment[]): ScriptSegment[] {
  return segments.filter(
    (s) => s.language === 'english' && s.text.trim().length > 0 && isPureEnglishSegment(s.text)
  )
}

/** 在纯英文候选中取窗口；与字幕批次位置成比例对齐。 */
export function pickNearbyScriptSegments(
  segments: ScriptSegment[],
  subtitleBatchStartIndex: number,
  totalSubtitleLines: number
): ScriptSegment[] {
  const pool = listDeepSeekEnglishOnlySegments(segments)
  if (pool.length === 0) return []
  const take = Math.min(REAL_ALIGN_SEGMENT_WINDOW, pool.length)
  const denom = Math.max(1, totalSubtitleLines - 1)
  const ratio = Math.min(1, Math.max(0, subtitleBatchStartIndex / denom))
  const maxStart = Math.max(0, pool.length - take)
  const start = Math.floor(ratio * maxStart)
  return pool.slice(start, start + take)
}

const SYSTEM_PROMPT = `You are a bilingual subtitle alignment engine.

Task: Match each Chinese subtitle line to one or more consecutive English script segments.

Rules:
1. Process subtitles in ascending orderIndex order (subtitle order is fixed).
2. Each script segment may be used at most once across all subtitles.
3. Only choose segments from the provided list; use their exact segmentId strings.
4. Prefer consecutive segments when one subtitle needs multiple segments (one-to-many).
5. Do not "jump" across unrelated segments: only use a contiguous run from the segment list order.
6. For each subtitle you may output multiple alternative match rows with the same subtitleId (different segment choices). Put the best alternative first.
7. confidence is a number between 0 and 1.
8. reason is a short English explanation.

English-only constraints (mandatory):
- Only use candidate segments from the provided English candidates list. Do not invent segment ids.
- Do not generate or use Chinese text in the "english" field. Return English text only in the "english" field.
- Do not match or quote mixed-language segments; the candidate list is English-only.

Output: Return JSON only (no markdown, no code fences, no commentary). The JSON must parse with JSON.parse and have this exact shape:
{"matches":[{"subtitleId":1,"matchedSegmentIds":["seg_x"],"english":"...","confidence":0.92,"reason":"..."}]}`

export function buildAlignmentUserPayload(
  subtitles: AlignmentPromptSubtitle[],
  englishCandidates: AlignmentPromptSegment[]
): string {
  return JSON.stringify(
    {
      subtitles,
      englishCandidatesOnly: englishCandidates,
      constraints: {
        maxSegmentsPerSubtitle: 6,
        segmentReuse: 'forbidden',
        ordering: 'subtitles_fixed_order'
      }
    },
    null,
    2
  )
}

export function buildAlignmentMessages(
  subtitles: AlignmentPromptSubtitle[],
  englishCandidates: AlignmentPromptSegment[]
): { messages: Array<{ role: 'system' | 'user'; content: string }>; promptCharCount: number } {
  const userContent = `${buildAlignmentUserPayload(subtitles, englishCandidates)}

Return JSON only.`
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent }
  ]
  const promptCharCount = messages.map((m) => m.content).join('\n').length
  return { messages, promptCharCount }
}

function stripJsonFences(text: string): string {
  const t = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/im.exec(t)
  if (fence?.[1]) return fence[1].trim()
  return t
}

function confidenceToPercent(conf: number): number {
  if (!Number.isFinite(conf)) return 0
  if (conf > 0 && conf <= 1) return Math.round(conf * 100)
  return Math.round(Math.min(100, Math.max(0, conf)))
}

function statusFromConfidencePct(pct: number): SubtitleStatus {
  if (pct > 90) return 'confirmed'
  if (pct >= 60) return 'low_confidence'
  return 'unmatched'
}

function coerceInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10)
  return null
}

function parseMatchRow(x: unknown): DeepSeekAlignmentMatchRow | null {
  if (x == null || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const subtitleId = coerceInt(o.subtitleId)
  if (subtitleId == null) return null
  if (!Array.isArray(o.matchedSegmentIds) || !o.matchedSegmentIds.every((id) => typeof id === 'string')) return null
  if (typeof o.english !== 'string') return null
  const confRaw = o.confidence
  const confidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw)
      ? confRaw
      : typeof confRaw === 'string' && confRaw.trim() !== '' && Number.isFinite(Number(confRaw))
        ? Number(confRaw)
        : NaN
  if (!Number.isFinite(confidence)) return null
  if (typeof o.reason !== 'string') return null
  return {
    subtitleId,
    matchedSegmentIds: o.matchedSegmentIds as string[],
    english: o.english,
    confidence,
    reason: o.reason
  }
}

export function parseAlignmentModelJson(raw: string): { ok: true; data: DeepSeekAlignmentResponseShape } | { ok: false; error: string } {
  let text = stripJsonFences(raw)
  const objStart = text.indexOf('{')
  const arrStart = text.indexOf('[')
  if (objStart === -1 && arrStart === -1) {
    return { ok: false, error: 'parse error: no JSON object found in model output' }
  }
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    return { ok: false, error: 'parse error: model returned a JSON array at root; expected {"matches":[...]}' }
  }
  text = text.slice(objStart)
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `parse error: ${msg}` }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'parse error: root JSON must be an object' }
  }
  const matchesRaw = (parsed as { matches?: unknown }).matches
  if (!Array.isArray(matchesRaw)) {
    return { ok: false, error: 'parse error: missing "matches" array' }
  }
  const matches: DeepSeekAlignmentMatchRow[] = []
  for (let i = 0; i < matchesRaw.length; i++) {
    const row = parseMatchRow(matchesRaw[i])
    if (!row) {
      return { ok: false, error: `parse error: invalid item at matches[${i}]` }
    }
    matches.push(row)
  }
  return { ok: true, data: { matches } }
}

export function validateDeepSeekAlignmentRows(
  matches: DeepSeekAlignmentMatchRow[],
  allowedSegmentIds: Set<string>
): DeepSeekAlignmentMatchValidated[] {
  return matches.map((m) => {
    const flags: DeepSeekMatchValidationFlag[] = []
    if (hasChineseChars(m.english)) flags.push('invalid_candidate')
    if (
      m.matchedSegmentIds.length === 0 ||
      m.matchedSegmentIds.some((id) => !allowedSegmentIds.has(id))
    ) {
      flags.push('invalid_segment_id')
    }
    return { ...m, validationFlags: flags, applyable: flags.length === 0 }
  })
}

export function buildAlignmentValidationWarnings(validated: DeepSeekAlignmentMatchValidated[]): string[] {
  const w: string[] = []
  validated.forEach((m, i) => {
    if (m.validationFlags.includes('invalid_candidate')) {
      w.push(`matches[${i}] #${m.subtitleId}: invalid_candidate (english contains CJK)`)
    }
    if (m.validationFlags.includes('invalid_segment_id')) {
      w.push(`matches[${i}] #${m.subtitleId}: invalid_segment_id (ids not in English candidate pool or empty)`)
    }
  })
  return w
}

export { confidenceToPercent, statusFromConfidencePct }
