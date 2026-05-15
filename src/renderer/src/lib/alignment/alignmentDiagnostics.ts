import type { ScriptSegment, SubtitleLine, CandidateSegmentGroup } from '../../types'
import {
  deriveStatusAfterAI,
  isStructuralAIWritable,
  pickBestStructuralAIForSubtitle,
  readableProblemsForAIRow
} from './applyPolicy'
import { getEnglishPoolWindowBounds } from './candidateGroups'
import type { LocalEnglishContextBlock } from './englishBlock'
import type { AlignmentMatchValidated } from './types'

export interface AlignmentBatchPipelineDiagnostics {
  subtitleBatch: Array<{
    subtitleId: number
    orderIndex: number
    chinese: string
    startMs: number
    endMs: number
  }>
  englishCursorUsed: number
  englishPoolSize: number
  groupWindow: { windowStart: number; windowEnd: number; windowSize: number }
  localEnglishContext: null | {
    startSegmentIndex: number
    endSegmentIndex: number
    segmentCount: number
    segments: Array<{ poolIndex: number; segmentId: string; text: string }>
    mergedTextPreview: string
  }
  candidateGroups: Array<{
    groupId: string
    segmentIds: string[]
    text: string
    startSegmentIndex: number
    endSegmentIndex: number
  }>
  promptSent: {
    systemPromptPreview: string
    userMessageFull: string
    userCharCount: number
    constraintsNote: string
  }
  deepSeekRawResponse: string
  validationRows: Array<{
    subtitleId: number
    structuralWriteOk: boolean
    modelApplyableFlag: boolean
    validationFlags: string[]
    groupId: string
    englishPreview: string
  }>
  finalApplyPerSubtitle: Array<{
    subtitleId: number
    autoWriteEnglish: boolean
    status: string | null
    problems: string[]
    pickedGroupId: string | null
    withinCandidateWindow: boolean
  }>
  checks: {
    candidateGroupsVsWindow: string
    localContextVsWindow: string
  }
}

export function buildAlignmentBatchPipelineDiagnostics(input: {
  batch: SubtitleLine[]
  engPool: ScriptSegment[]
  cursor: number
  windowSize: number
  localEnglishContext: LocalEnglishContextBlock | null
  candidateGroups: CandidateSegmentGroup[]
  messages: Array<{ role: string; content: string }>
  rawResponse: string
  validated: AlignmentMatchValidated[]
  batchSubtitleIds: number[]
  thresholdPct: number
}): AlignmentBatchPipelineDiagnostics {
  const poolLength = input.engPool.length
  const { windowStart, windowEnd } = getEnglishPoolWindowBounds(poolLength, input.cursor, input.windowSize)

  const localEnglishContext = input.localEnglishContext
    ? {
        startSegmentIndex: input.localEnglishContext.startSegmentIndex,
        endSegmentIndex: input.localEnglishContext.endSegmentIndex,
        segmentCount: input.localEnglishContext.segmentCount,
        mergedTextPreview:
          input.localEnglishContext.text.length > 600
            ? `${input.localEnglishContext.text.slice(0, 600)}…`
            : input.localEnglishContext.text,
        segments: input.localEnglishContext.segmentIds.map((id) => {
          const idx = input.engPool.findIndex((s) => s.id === id)
          const seg = idx >= 0 ? input.engPool[idx] : undefined
          return {
            poolIndex: idx,
            segmentId: id,
            text: seg?.text ?? '(id not in current english pool slice)'
          }
        })
      }
    : null

  let groupsVsWindow = 'no candidate groups'
  if (input.candidateGroups.length > 0) {
    const gmin = Math.min(...input.candidateGroups.map((g) => g.startSegmentIndex))
    const gmax = Math.max(...input.candidateGroups.map((g) => g.endSegmentIndex))
    const near =
      gmin >= windowStart - 1 && gmax <= windowEnd + 1
        ? 'yes'
        : `check: groups [${gmin},${gmax}] vs window [${windowStart},${windowEnd}]`
    groupsVsWindow = `${near} (minStart=${gmin}, maxEnd=${gmax})`
  }

  let ctxVsWindow = 'no local context block'
  if (localEnglishContext) {
    const overlap =
      localEnglishContext.endSegmentIndex >= windowStart &&
      localEnglishContext.startSegmentIndex <= windowEnd
    ctxVsWindow = overlap
      ? 'yes: overlaps group window'
      : `warning: context [${localEnglishContext.startSegmentIndex},${localEnglishContext.endSegmentIndex}] vs window [${windowStart},${windowEnd}]`
  }

  const systemPrompt = input.messages.find((m) => m.role === 'system')?.content ?? ''
  const userMsg = input.messages.find((m) => m.role === 'user')?.content ?? ''

  const validationRows = input.validated.map((v) => ({
    subtitleId: v.subtitleId,
    structuralWriteOk: isStructuralAIWritable(
      v,
      input.candidateGroups,
      input.cursor,
      poolLength,
      input.windowSize
    ),
    modelApplyableFlag: v.applyable,
    validationFlags: [...v.validationFlags],
    groupId: v.groupId,
    englishPreview: v.english.length > 160 ? `${v.english.slice(0, 160)}…` : v.english
  }))

  const finalApplyPerSubtitle = input.batchSubtitleIds.map((id) => {
    const best = pickBestStructuralAIForSubtitle(
      input.validated,
      id,
      input.candidateGroups,
      input.cursor,
      poolLength,
      input.windowSize
    )
    if (!best) {
      return {
        subtitleId: id,
        autoWriteEnglish: false,
        status: null,
        problems: ['AI did not return a reliable match.'],
        pickedGroupId: null,
        withinCandidateWindow: false
      }
    }
    const within = isStructuralAIWritable(
      best,
      input.candidateGroups,
      input.cursor,
      poolLength,
      input.windowSize
    )
    return {
      subtitleId: id,
      autoWriteEnglish: within,
      status: deriveStatusAfterAI(best, input.thresholdPct),
      problems: readableProblemsForAIRow(best, input.thresholdPct),
      pickedGroupId: best.groupId,
      withinCandidateWindow: within
    }
  })

  return {
    subtitleBatch: input.batch.map((l, i) => ({
      subtitleId: l.id,
      orderIndex: i + 1,
      chinese: l.chinese,
      startMs: l.start,
      endMs: l.end
    })),
    englishCursorUsed: input.cursor,
    englishPoolSize: poolLength,
    groupWindow: { windowStart, windowEnd, windowSize: input.windowSize },
    localEnglishContext,
    candidateGroups: input.candidateGroups.map((g) => ({
      groupId: g.id,
      segmentIds: [...g.segmentIds],
      text: g.text.length > 240 ? `${g.text.slice(0, 240)}…` : g.text,
      startSegmentIndex: g.startSegmentIndex,
      endSegmentIndex: g.endSegmentIndex
    })),
    promptSent: {
      systemPromptPreview: systemPrompt.length > 1200 ? `${systemPrompt.slice(0, 1200)}…` : systemPrompt,
      userMessageFull: userMsg,
      userCharCount: userMsg.length,
      constraintsNote:
        'User JSON includes englishCandidateGroups (only valid picks), constraints.oneMatchPerSubtitle, selectionMustUseCandidateGroups, localEnglishContextBlock read-only.'
    },
    deepSeekRawResponse: input.rawResponse,
    validationRows,
    finalApplyPerSubtitle,
    checks: {
      candidateGroupsVsWindow: groupsVsWindow,
      localContextVsWindow: ctxVsWindow
    }
  }
}

/** 完整 batch pipeline 快照：控制台搜索 `[alignment-pipeline]`。 */
export function logAlignmentBatchPipelineDiagnostics(trace: AlignmentBatchPipelineDiagnostics): void {
  const MAX = 64_000
  const raw = trace.deepSeekRawResponse
  const forLog =
    raw.length > MAX
      ? { ...trace, deepSeekRawResponse: `${raw.slice(0, MAX)}\n… [truncated ${raw.length - MAX} chars]` }
      : trace
  console.warn('[alignment-pipeline]', JSON.stringify(forLog, null, 2))
}
