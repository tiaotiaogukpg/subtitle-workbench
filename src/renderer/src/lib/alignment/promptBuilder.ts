import type { CandidateSegmentGroup } from '../../types'
import type { LocalEnglishContextBlock } from './englishBlock'
import type { AlignmentMatchRow, AlignmentModelResponseShape, AlignmentPromptSubtitle } from './types'

export function estimatePromptTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

const SYSTEM_PROMPT = `You are a bilingual subtitle alignment engine for consecutive interview subtitles.

Critical batch model:
- The subtitles in this batch are ONE continuous Chinese discourse span (e.g. #006–#011).
- They usually map to ONE continuous English answer flow in localEnglishContextBlock — not one isolated English sentence per Chinese line.
- Read the entire batch and the full local English context BEFORE assigning any groupId.
- Do NOT treat each subtitle as an independent search task.

Workflow:
1. Read all Chinese lines in order and infer the shared English answer flow.
2. Read localEnglishContextBlock (if present) as the likely continuous English source.
3. Assign englishCandidateGroups in ascending pool segment order across the batch.
4. Typical pattern: subtitle #006 → seg20–21, #007 → seg22, #008 → seg23 (forward, no large jumps).

Task: Match each Chinese subtitle to exactly ONE group from "englishCandidateGroups".

Rules:
1. Process subtitles in ascending orderIndex order.
2. Return exactly one match row per subtitleId in the batch — no skips, no empty english.
3. Each script segment id may be used at most once in this batch.
4. Pick only groupId from "englishCandidateGroups"; matchedSegmentIds and english must match that group exactly.
5. Do NOT invent ids or paraphrase English.
6. confidence is 0–1; reason is a short English explanation.

Sequential discipline:
- Segment indices should move forward: startIndex of each row should be near the previous row's endIndex.
- No large jumps (e.g. #006 → pool[20], #007 → pool[88] is wrong).
- No backward reuse of earlier segments.
- If uncertain, still return the best plausible next group with lower confidence — never omit a subtitle.

Local English context:
- localEnglishContextBlock is read-only background for the continuous answer flow.
- You MUST still choose groupId only from englishCandidateGroups.

Output: JSON only. Shape:
{"matches":[{"subtitleId":7,"groupId":"g_10_12","matchedSegmentIds":["seg_10","seg_11"],"english":"...","confidence":0.91,"reason":"..."}]}`

export interface BatchAlignmentPromptInput {
  subtitles: AlignmentPromptSubtitle[]
  candidateGroups: CandidateSegmentGroup[]
  localEnglishContext?: LocalEnglishContextBlock | null
}

export function buildBatchAlignmentUserPayload(input: BatchAlignmentPromptInput): string {
  const { subtitles, candidateGroups, localEnglishContext } = input
  const subtitleIds = subtitles.map((s) => s.subtitleId)
  const payload: Record<string, unknown> = {
    batchSpan: {
      subtitleIds,
      isConsecutiveDiscourse: true,
      workflow: [
        'Treat all subtitleIds as one continuous Chinese span.',
        'Map them to one continuous English answer flow (see localEnglishContextBlock).',
        'Assign candidate groups in forward segment order; do not match lines in isolation.'
      ]
    },
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
      batchIsContinuousSemanticSpan: true,
      sequentialSegmentOrder: 'forward_only',
      maxForwardGapSegments: 3,
      noEmptyEnglish: true,
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
