import type { CandidateSegmentGroup } from '../../types'
import type {
  AlignmentMatchRow,
  AlignmentModelResponseShape,
  BatchAlignmentPromptInput
} from './types'

const SYSTEM_PROMPT = `You are a bilingual subtitle alignment engine for consecutive interview subtitles.

You receive localEnglishContextBlock: a read-only window of English transcript text (segmentIds + joined text). Your job is semantic slicing and semantic matching: for each Chinese subtitle line, choose the English phrase that best aligns with it.

Rules:
1. For each subtitle, output english as an EXACT contiguous substring of localEnglishContextBlock.text (after normalizing your internal whitespace to single spaces). Do not paraphrase or translate.
2. matchedSegmentIds must list every Script Pool segment id that your english span covers, in order, contiguous in the pool (infer from the substring position if unsure).
3. groupId is optional; use "g_context" if you have no separate group id.
4. Process subtitles in ascending orderIndex.
5. Return exactly one match per subtitleId — no skips, no empty english.
6. Prefer moving forward in transcript order across the batch when plausible.
7. confidence is 0–1; reason is a short English explanation.

englishCandidateGroups (if present) is DEBUG ONLY — a per-segment slice list. Do NOT select from it. Slicing is your responsibility inside localEnglishContextBlock.text.

Output: JSON only. Shape:
{"matches":[{"subtitleId":7,"groupId":"g_context","matchedSegmentIds":["…"],"english":"exact substring from context","confidence":0.91,"reason":"..."}]}`

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
    batchSpan: {
      subtitleIds,
      isConsecutiveDiscourse: true,
      workflow: [
        'Slice and align using localEnglishContextBlock.text only (exact substring).',
        'englishCandidateGroups is debug reference only — do not pick groupId from it.',
        'Prefer forward motion in pool segment order across the batch.'
      ]
    },
    subtitles: subtitles.map((s) => ({
      subtitleId: s.subtitleId,
      orderIndex: s.orderIndex,
      chinese: s.chinese
    })),
    englishCandidateGroupsDebug: candidateGroups.map(serializeCandidateGroup),
    constraints: {
      selectionMode: 'local_context_substring',
      segmentReuse: 'Avoid reusing the same English span when two subtitles need distinct phrases.',
      ordering: 'subtitles_fixed_order',
      oneMatchPerSubtitle: true,
      batchIsConsecutive: true,
      noEmptyEnglish: true,
      localContextIsReadOnly: true
    }
  }

  if (localEnglishContext) {
    payload.localEnglishContextBlock = {
      segmentIds: localEnglishContext.segmentIds,
      text: localEnglishContext.text,
      startSegmentIndex: localEnglishContext.startSegmentIndex,
      endSegmentIndex: localEnglishContext.endSegmentIndex,
      segmentCount: localEnglishContext.segmentCount,
      note:
        'Authoritative English source. Each subtitle.english must be copied verbatim as a contiguous substring of "text" (space-normalized).'
    }
  }

  return JSON.stringify(payload, null, 2)
}

export function buildBatchAlignmentPrompt(
  input: BatchAlignmentPromptInput
): { messages: Array<{ role: 'system' | 'user'; content: string }>; promptCharCount: number } {
  const userContent = `${buildBatchAlignmentUserPayload(input)}

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
  return {
    subtitleId,
    groupId,
    matchedSegmentIds,
    english: o.english,
    confidence,
    reason: o.reason
  }
}
