import type { CandidateSegmentGroup } from '../../types'
import type { LocalEnglishContextBlock } from './englishBlock'
import type { AlignmentMatchRow, AlignmentModelResponseShape, AlignmentPromptSubtitle } from './types'

export function estimatePromptTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

const SYSTEM_PROMPT = `You are a bilingual subtitle alignment engine.

Batch context:
The subtitles in this batch are consecutive.
They may correspond to one continuous English answer block.
Do not match each subtitle independently.
Understand the whole batch first, then assign consecutive English candidate groups to each subtitle.

Task: Match each Chinese subtitle line to exactly ONE English candidate GROUP from "englishCandidateGroups".

Rules:
1. Process subtitles in ascending orderIndex order (subtitle order is fixed).
2. You MUST return exactly one match row per subtitle in the batch — every subtitleId listed must appear in "matches".
3. Each script segment id may be used at most once across all subtitles in this batch.
4. You MUST choose by groupId from "englishCandidateGroups". Each group has fixed segmentIds and canonical "text".
5. In each match row: "groupId" must be one of the provided group ids. "matchedSegmentIds" MUST match that group's segmentIds in order. "english" MUST copy the group's text (whitespace may be normalized to single spaces).
6. Do NOT invent segment ids or group ids. Do NOT paraphrase the English.
7. confidence is a number between 0 and 1.
8. reason is a short English explanation.

Assignment discipline:
- For every subtitle, return one match.
- The selected groups should usually move forward in order.
- Do not skip subtitles.
- Do not jump far ahead.
- Do not reuse the same segment unless necessary.

Local English context:
- "localEnglishContextBlock" (if present) is read-only background showing the likely continuous English answer near the cursor.
- You MUST still pick groupId only from "englishCandidateGroups".
- Do NOT select segments outside the candidate groups list.

English-only constraints:
- Do not use Chinese or CJK in the "english" field.
- Only use groups from englishCandidateGroups.

Output: Return JSON only (no markdown, no code fences). Shape:
{"matches":[{"subtitleId":7,"groupId":"g_10_12","matchedSegmentIds":["seg_10","seg_11"],"english":"...","confidence":0.91,"reason":"..."}]}`

export interface BatchAlignmentPromptInput {
  subtitles: AlignmentPromptSubtitle[]
  candidateGroups: CandidateSegmentGroup[]
  localEnglishContext?: LocalEnglishContextBlock | null
}

export function buildBatchAlignmentUserPayload(input: BatchAlignmentPromptInput): string {
  const { subtitles, candidateGroups, localEnglishContext } = input
  const payload: Record<string, unknown> = {
    subtitles,
    englishCandidateGroups: candidateGroups.map((g) => ({
      groupId: g.id,
      segmentIds: g.segmentIds,
      text: g.text,
      startSegmentIndex: g.startSegmentIndex,
      endSegmentIndex: g.endSegmentIndex,
      wordCount: g.wordCount,
      charCount: g.charCount
    })),
    constraints: {
      selectionMode: 'candidate_group_pick',
      segmentReuse: 'forbidden',
      ordering: 'subtitles_fixed_order',
      oneMatchPerSubtitle: true,
      batchIsConsecutive: true,
      localContextIsReadOnly: true,
      selectionMustUseCandidateGroups: true
    }
  }

  if (localEnglishContext) {
    payload.localEnglishContextBlock = {
      segmentIds: localEnglishContext.segmentIds,
      text: localEnglishContext.text,
      startSegmentIndex: localEnglishContext.startSegmentIndex,
      endSegmentIndex: localEnglishContext.endSegmentIndex,
      segmentCount: localEnglishContext.segmentCount,
      note: 'Context only. All matches must use groupId from englishCandidateGroups.'
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
