import type { CandidateSegmentGroup } from '../../types'
import type {
  AlignmentMatchParseWarning,
  AlignmentMatchRow,
  AlignmentModelResponseShape,
  BatchAlignmentPromptInput
} from './types'

const SYSTEM_PROMPT = `You are aligning a consecutive Chinese subtitle batch to an English transcript.

The English context is a time-estimated window for this subtitle batch (derived from subtitle timeline position, NOT from prior batch results).
Do NOT search outside the provided englishContext.text.
Align ONLY within this English context string.

For each Chinese subtitle in the batch (fixed order):
- Return the shortest English span that matches that subtitle.
- english must be an EXACT contiguous substring of the provided English context string (single spaces between words; no paraphrase).
- Do not translate. Do not invent words. Preserve English wording exactly.
- Keep matches in forward order through the English context (later subtitles should not pull text from much earlier than previous lines unless unavoidable).
- Do not assign the same English character span to two subtitles (no duplicate [spanStart, spanEnd)).

When two adjacent Chinese subtitles correspond to different parts of the same English sentence,
split the English sentence into non-overlapping spans.
Do not include the next subtitle's meaning in the current subtitle's English span.
If subtitle A means the first action and subtitle B means the result,
return A = first action only and B = result only.

Example (verbatim substrings from the same English sentence):
Chinese A: 结果其实跑去看了 Bodyguard
Chinese B: 然后就被抓包了
English source: And I went to Bodyguard and I got caught.
Correct: A = "And I went to Bodyguard" · B = "and I got caught"
Wrong: A = "And I went to Bodyguard and I got caught" · B = "and I got caught"

If two Chinese subtitles relate to the same original English sentence:
- Split the English into different non-overlapping spans for each subtitle.
- Do not repeat the same full sentence for multiple subtitles.

When the English source sentence is too short or semantically compact to split naturally across multiple adjacent Chinese subtitles,
prefer assigning the full English sentence to the single most semantically dominant subtitle.
Do NOT duplicate the same English span across multiple subtitles.
Do NOT force artificial micro-splitting.
It is acceptable for one adjacent subtitle to remain empty if the English source does not naturally support subdivision.

Example (adjacent Chinese lines, one English thought):
Chinese:
#42 所以两周前我听到这个消息的时候
#43 我的反应完全是：“等等，什么？”
English source:
So two weeks ago I was like wait, what?

GOOD:
#42 -> empty english
#43 -> So two weeks ago I was like wait, what?

BAD:
#42 -> So two weeks ago I was like wait, what?
#43 -> So two weeks ago I was like wait, what?

Output JSON only. Each match object fields:
subtitleId (number), english (string), spanStart (0-based int into englishContext.text), spanEnd (exclusive int), confidence (0-1 number), reason (short string).

Do not include matchedSegmentIds, groupId, or sourceContextIds.

englishCandidateGroupsDebug in the user payload is DEBUG ONLY — ignore it for alignment.`

const RETRY_COVERAGE_SYSTEM_APPEND = `

RETRY COVERAGE PASS:
This is a retry pass for previously unmatched subtitles.
Focus ONLY on the subtitles listed in this batch.
Return the best non-overlapping English span from the provided context (same verbatim substring rules as above).`

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
  const { subtitles, candidateGroups, localEnglishContext, alignmentPass } = input
  const subtitleIds = subtitles.map((s) => s.subtitleId)
  const payload: Record<string, unknown> = {
    task: 'chinese_batch_to_english_spans',
    batchSpan: {
      subtitleIds,
      isConsecutiveDiscourse: true,
      ...(alignmentPass === 'retry_coverage' ? { retryCoveragePass: true } : {})
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
    const tr = localEnglishContext.timeRatio
    payload.englishContext = {
      text: localEnglishContext.text,
      segmentIds: localEnglishContext.segmentIds,
      segmentCount: localEnglishContext.segmentCount,
      poolSegmentRange: tr
        ? {
            windowStartIndex: tr.windowStartSeg,
            windowEndIndex: tr.windowEndSeg,
            estimatedCenterIndex: tr.englishCenterIndex
          }
        : {
            windowStartIndex: localEnglishContext.startSegmentIndex,
            windowEndIndex: localEnglishContext.endSegmentIndex
          },
      timeEstimate: tr
        ? {
            batchMidRatio: tr.batchMidRatio,
            batchTimeMs: { start: tr.batchStartMs, end: tr.batchEndMs },
            windowTier: tr.windowTier
          }
        : undefined,
      note:
        alignmentPass === 'retry_coverage'
          ? 'RETRY COVERAGE PASS: focus only on the subtitles in this batch. Return the best non-overlapping English span from this "text" string only (verbatim substring; spanStart/spanEnd 0-based into this "text").'
          : 'Time-estimated window for THIS batch only. Do NOT use text outside this "text" string. All english must be verbatim substrings; spanStart/spanEnd are 0-based into this "text" only.'
    }
  }

  return JSON.stringify(payload, null, 2)
}

export function buildBatchAlignmentPrompt(
  input: BatchAlignmentPromptInput
): { messages: Array<{ role: 'system' | 'user'; content: string }>; promptCharCount: number } {
  const userContent = `${buildBatchAlignmentUserPayload(input)}

Return JSON only, shape: {"matches":[{"subtitleId":1,"english":"...","spanStart":0,"spanEnd":0,"confidence":0.9,"reason":"..."}]}`
  const systemPrompt =
    input.alignmentPass === 'retry_coverage' ? SYSTEM_PROMPT + RETRY_COVERAGE_SYSTEM_APPEND : SYSTEM_PROMPT
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: systemPrompt },
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
  const parseWarnings: AlignmentMatchParseWarning[] = []
  for (let i = 0; i < matchesRaw.length; i++) {
    const rawItem = matchesRaw[i]
    const parsedItem = parseMatchRow(rawItem)
    if (parsedItem.ok) {
      matches.push(parsedItem.row)
    } else {
      parseWarnings.push({
        index: i,
        subtitleId: parsedItem.subtitleId,
        reason: parsedItem.reason,
        rawItemPreview: rawMatchItemPreview(rawItem)
      })
    }
  }
  if (matches.length === 0) {
    const emptyDetail = parseWarnings.length
      ? ` (${parseWarnings.length} item(s) skipped, see parseWarnings)`
      : ' (matches array was empty)'
    return { ok: false, error: `parse error: no valid items in matches${emptyDetail}` }
  }
  return { ok: true, data: { matches, parseWarnings } }
}

function rawMatchItemPreview(x: unknown, maxLen = 320): string {
  try {
    const s = JSON.stringify(x)
    if (typeof s !== 'string') return String(x)
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
  } catch {
    return '[unserializable]'
  }
}

type ParseMatchItemResult =
  | { ok: true; row: AlignmentMatchRow }
  | { ok: false; reason: string; subtitleId: number | null }

/**
 * 解析单条模型 match；失败时返回原因与尽量提取的 subtitleId（用于诊断，不抛错）。
 */
export function parseMatchRow(x: unknown): ParseMatchItemResult {
  if (x == null || typeof x !== 'object' || Array.isArray(x)) {
    return { ok: false, reason: 'item must be a non-null object', subtitleId: null }
  }
  const o = x as Record<string, unknown>
  const subtitleId = coerceInt(o.subtitleId)
  if (subtitleId == null) {
    return {
      ok: false,
      reason: 'missing or invalid subtitleId (must be integer)',
      subtitleId: null
    }
  }
  const groupIdRaw = o.groupId
  const groupId =
    typeof groupIdRaw === 'string' && groupIdRaw.trim() !== '' ? groupIdRaw.trim() : 'g_context'
  const idsRaw = o.matchedSegmentIds
  const matchedSegmentIds = Array.isArray(idsRaw)
    ? idsRaw.filter((id): id is string => typeof id === 'string')
    : []
  if (typeof o.english !== 'string') {
    return {
      ok: false,
      reason: 'english must be a string',
      subtitleId
    }
  }
  const confRaw = o.confidence
  const confidence =
    typeof confRaw === 'number' && Number.isFinite(confRaw)
      ? confRaw
      : typeof confRaw === 'string' && confRaw.trim() !== '' && Number.isFinite(Number(confRaw))
        ? Number(confRaw)
        : NaN
  if (!Number.isFinite(confidence)) {
    return {
      ok: false,
      reason: 'confidence must be a finite number (or numeric string)',
      subtitleId
    }
  }
  if (typeof o.reason !== 'string') {
    return {
      ok: false,
      reason: 'reason must be a string',
      subtitleId
    }
  }

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
    ok: true,
    row: {
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
}
