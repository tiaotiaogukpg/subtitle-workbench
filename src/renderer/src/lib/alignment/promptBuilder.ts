import type { CandidateSegmentGroup } from '../../types'
import type {
  AlignmentMatchRow,
  AlignmentModelResponseShape,
  BatchAlignmentPromptInput
} from './types'

const SYSTEM_PROMPT = `You are a bilingual subtitle alignment engine for consecutive interview subtitles.

The user JSON contains one shared list "englishCandidateGroups". Each group has groupId, segmentIds, and text. You MUST pick groupId only from that list.

localEnglishContextBlock (if present) is read-only context for discourse flow; do NOT output its full text as subtitle.english — only the exact "english" field of the chosen group.

Rules:
1. Process subtitles in ascending orderIndex.
2. Return exactly one match per subtitleId — no skips, no empty english.
3. Each groupId at most once per batch (unless the model truly cannot fit; still never invent ids).
4. matchedSegmentIds and english must match the chosen group exactly.
5. Do NOT invent ids or paraphrase English.
6. confidence is 0–1; reason is a short English explanation.

Output: JSON only. Shape:
{"matches":[{"subtitleId":7,"groupId":"g_10_12","matchedSegmentIds":["seg_10","seg_11"],"english":"...","confidence":0.91,"reason":"..."}]}`

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
        'Pick groupId only from englishCandidateGroups.',
        'Use localEnglishContextBlock only to understand flow; output must be a chosen group text, not the full context.',
        'Prefer moving forward in pool segment order across the batch.'
      ]
    },
    subtitles: subtitles.map((s) => ({
      subtitleId: s.subtitleId,
      orderIndex: s.orderIndex,
      chinese: s.chinese
    })),
    englishCandidateGroups: candidateGroups.map(serializeCandidateGroup),
    constraints: {
      selectionMode: 'shared_candidate_group_list',
      segmentReuse: 'Each groupId at most once per batch when possible.',
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
        'Read-only context for discourse only. Never paste this block as subtitle.english — only pick from englishCandidateGroups.'
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
  if (typeof o.groupId !== 'string' || o.groupId.trim() === '') return null
  if (!Array.isArray(o.matchedSegmentIds) || !o.matchedSegmentIds.every((id) => typeof id === 'string')) {
    return null
  }
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
    groupId: o.groupId.trim(),
    matchedSegmentIds: o.matchedSegmentIds as string[],
    english: o.english,
    confidence,
    reason: o.reason
  }
}
