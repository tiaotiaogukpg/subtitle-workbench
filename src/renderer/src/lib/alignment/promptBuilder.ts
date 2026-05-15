import type { CandidateSegmentGroup } from '../../types'
import type {
  AlignmentMatchRow,
  AlignmentModelResponseShape,
  BatchAlignmentPromptInput
} from './types'

const SYSTEM_PROMPT = `You are aligning a consecutive Chinese subtitle batch to an English transcript.

For each Chinese subtitle in the batch (fixed order):
- Return the shortest English span that matches that subtitle.
- english must be an EXACT contiguous substring of the provided English context string (single spaces between words; no paraphrase).
- Do not translate. Do not invent words. Preserve English wording exactly.
- Keep matches in forward order through the English context (later subtitles should not pull text from much earlier than previous lines unless unavoidable).
- Do not assign the same English character span to two subtitles (no duplicate [spanStart, spanEnd)).

If two Chinese subtitles relate to the same original English sentence:
- Split the English into different non-overlapping spans for each subtitle.
- Do not repeat the same full sentence for multiple subtitles.

Output JSON only. Each match object fields:
subtitleId (number), english (string), spanStart (0-based int into englishContext.text), spanEnd (exclusive int), confidence (0-1 number), reason (short string).

Do not include matchedSegmentIds, groupId, or sourceContextIds.

englishCandidateGroupsDebug in the user payload is DEBUG ONLY — ignore it for alignment.`

function serializeCandidateGroup(g: CandidateSegmentGroup) {
  return {
    groupId: g.id,
    segmentIds: g.segmentIds,
    text: g.text,
    startSegmentIndex: g.startSegmentIndex,
    endSegmentIndex: g.endSegmentIndex,
    wordCount: g.wordCount,
    charCount: g.charCount
  }
}

export function buildBatchAlignmentUserPayload(input: BatchAlignmentPromptInput): string {
  const { subtitles, candidateGroups, localEnglishContext } = input
  const subtitleIds = subtitles.map((s) => s.subtitleId)
  const payload: Record<string, unknown> = {
    task: 'chinese_batch_to_english_spans',
    batchSpan: {
      subtitleIds,
      isConsecutiveDiscourse: true
    },
    subtitles: subtitles.map((s) => ({
      subtitleId: s.subtitleId,
      orderIndex: s.orderIndex,
      chinese: s.chinese
    })),
    englishCandidateGroupsDebug: candidateGroups.map(serializeCandidateGroup),
    constraints: {
      englishMustBeVerbatimSubstring: true,
      noTranslation: true,
      orderedForwardSpans: true,
      noDuplicateSpanAcrossSubtitles: true,
      oneMatchPerSubtitle: true
    }
  }

  if (localEnglishContext) {
    payload.englishContext = {
      text: localEnglishContext.text,
      segmentIds: localEnglishContext.segmentIds,
      segmentCount: localEnglishContext.segmentCount,
      note:
        'Authoritative English source for this batch. All english fields must be copied verbatim from "text". spanStart/spanEnd are 0-based indices into this same "text" string only.'
    }
  }

  return JSON.stringify(payload, null, 2)
}

export function buildBatchAlignmentPrompt(
  input: BatchAlignmentPromptInput
): { messages: Array<{ role: 'system' | 'user'; content: string }>; promptCharCount: number } {
  const userContent = `${buildBatchAlignmentUserPayload(input)}

Return JSON only, shape: {"matches":[{"subtitleId":1,"english":"...","spanStart":0,"spanEnd":0,"confidence":0.9,"reason":"..."}]}`
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

function coerceInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10)
  return null
}

export function parseAlignmentModelJson(
  raw: string
): { ok: true; data: AlignmentModelResponseShape } | { ok: false; error: string } {
  let text = stripJsonFences(raw)
  const objStart = text.indexOf('{')
  const arrStart = text.indexOf('[')
  if (objStart === -1 && arrStart === -1) {
    return { ok: false, error: 'parse error: no JSON object found in model output' }
  }
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    return { ok: false, error: 'parse error: root must be {"matches":[...]}' }
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
  const matches: AlignmentMatchRow[] = []
  for (let i = 0; i < matchesRaw.length; i++) {
    const row = parseMatchRow(matchesRaw[i])
    if (!row) return { ok: false, error: `parse error: invalid item at matches[${i}]` }
    matches.push(row)
  }
  return { ok: true, data: { matches } }
}

function parseMatchRow(x: unknown): AlignmentMatchRow | null {
  if (x == null || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const subtitleId = coerceInt(o.subtitleId)
  if (subtitleId == null) return null
  const groupIdRaw = o.groupId
  const groupId =
    typeof groupIdRaw === 'string' && groupIdRaw.trim() !== '' ? groupIdRaw.trim() : 'g_context'
  const idsRaw = o.matchedSegmentIds
  const matchedSegmentIds = Array.isArray(idsRaw)
    ? idsRaw.filter((id): id is string => typeof id === 'string')
    : []
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

  const scRaw = o.sourceContextIds
  const sourceContextIds = Array.isArray(scRaw)
    ? scRaw.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    : undefined

  const spanStart = coerceInt(o.spanStart)
  const spanEnd = coerceInt(o.spanEnd)
  let declaredSpanStart: number | undefined
  let declaredSpanEnd: number | undefined
  if (spanStart != null && spanEnd != null && spanStart >= 0 && spanEnd > spanStart) {
    declaredSpanStart = spanStart
    declaredSpanEnd = spanEnd
  }

  return {
    subtitleId,
    groupId,
    matchedSegmentIds,
    english: o.english,
    confidence,
    reason: o.reason,
    sourceContextIds: sourceContextIds?.length ? sourceContextIds : undefined,
    declaredSpanStart,
    declaredSpanEnd,
    spanStart: declaredSpanStart,
    spanEnd: declaredSpanEnd
  }
}
