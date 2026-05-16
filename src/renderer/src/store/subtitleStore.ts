import { create } from 'zustand'
import { mergeAlignmentProblems } from '../lib/alignment/applyPolicy'
import {
  buildAiAttemptPayloadFromWritableRow,
  newAiAttemptId,
  resolveStatusWhenApplyingAttempt,
  trimAttemptsList
} from '../lib/alignment/aiAttempts'
import type { AlignmentMatchRow, AlignmentMatchValidated } from '../lib/alignment/types'
import { confidenceToPercent } from '../lib/alignment/types'
import type {
  CandidateMatch,
  SubtitleAiAttempt,
  SubtitleAiAttemptSource,
  SubtitleLine,
  SubtitleStatus
} from '../types'
import { useScriptPoolStore } from './scriptPoolStore'

export type AiMatchBatchEntry = {
  subtitleId: number
  primary: AlignmentMatchRow
  status: SubtitleStatus
  problems: string[]
  candidates: CandidateMatch[]
  attemptBestValidated?: AlignmentMatchValidated
  attemptSource?: SubtitleAiAttemptSource
  attemptContextTier?: number
}

export interface SubtitleStoreState {
  subtitles: SubtitleLine[]
  currentSubtitleId: number | null
}

export interface SubtitleStoreActions {
  selectSubtitle: (id: number) => void
  setSubtitles: (subtitles: SubtitleLine[]) => void
  updateSubtitle: (id: number, patch: Partial<SubtitleLine>) => void
  updateConfidence: (id: number, confidence: number) => void
  updateStatus: (id: number, status: SubtitleStatus) => void
  replaceEnglish: (id: number, english: string, matchedSegmentIds?: string[]) => void
  addProblem: (id: number, problem: string) => void
  removeProblem: (id: number, problem: string) => void
  /** 仅追加 AI 尝试记录（不修改 english）。 */
  appendSubtitleAiAttempts: (
    items: Array<{ subtitleId: number; attempt: Omit<SubtitleAiAttempt, 'id' | 'createdAt'> }>
  ) => void
  removeSubtitleAiAttempt: (subtitleId: number, attemptId: string) => void
  /** 将某条尝试应用为当前 `english` 与状态。 */
  applySubtitleAiAttempt: (subtitleId: number, attemptId: string, confidenceThresholdPct: number) => void
  /** 整文件对齐：写入 AI 英文 + 状态 + 可读 problems + 候选（含 source），并追加 `aiAttempts`。 */
  applyFullFileAIMatchBatch: (entries: AiMatchBatchEntry[], confidenceThresholdPct: number) => void
  /** Retry Coverage Pass：仅更新非 confirmed/manual 行，并追加 `aiAttempts`。 */
  applyRetryCoverageMatchBatch: (entries: AiMatchBatchEntry[], confidenceThresholdPct: number) => void
  /** 标记需复查：默认不修改 english；若 clearEnglish 则清空英文与 matchedSegmentIds。 */
  applyAlignmentReviewStates: (
    entries: Array<{
      subtitleId: number
      candidates?: CandidateMatch[]
      problems: string[]
      clearEnglish?: boolean
    }>
  ) => void
  /** 用户跳过本批：全部 needs_review，不写入英文。 */
  markAlignmentBatchNeedsReview: (subtitleIds: number[]) => void
}

export type SubtitleStore = SubtitleStoreState & SubtitleStoreActions

function resolveCurrentIdAfterListChange(list: SubtitleLine[], prevId: number | null): number | null {
  if (list.length === 0) return null
  if (prevId != null && list.some((l) => l.id === prevId)) return prevId
  return list[0]!.id
}

function pushAttempt(line: SubtitleLine, attempt: SubtitleAiAttempt): SubtitleLine {
  return {
    ...line,
    aiAttempts: trimAttemptsList([...(line.aiAttempts ?? []), attempt])
  }
}

export const useSubtitleStore = create<SubtitleStore>((set, get) => ({
  subtitles: [],
  currentSubtitleId: null,

  setSubtitles: (subtitles) =>
    set((s) => ({
      subtitles,
      currentSubtitleId: resolveCurrentIdAfterListChange(subtitles, s.currentSubtitleId)
    })),

  selectSubtitle: (id) =>
    set((s) => {
      if (!s.subtitles.some((l) => l.id === id)) return s
      return { currentSubtitleId: id }
    }),

  updateSubtitle: (id, patch) =>
    set((s) => ({
      subtitles: s.subtitles.map((line) => (line.id === id ? { ...line, ...patch } : line))
    })),

  updateConfidence: (id, confidence) => get().updateSubtitle(id, { confidence }),

  updateStatus: (id, status) => get().updateSubtitle(id, { status }),

  replaceEnglish: (id, english, matchedSegmentIds) =>
    set((s) => ({
      subtitles: s.subtitles.map((line) =>
        line.id === id
          ? {
              ...line,
              english,
              matchedSegmentIds: matchedSegmentIds ?? line.matchedSegmentIds,
              manuallyEdited: true,
              status: line.status === 'unmatched' ? 'manual' : line.status
            }
          : line
      )
    })),

  addProblem: (id, problem) =>
    set((s) => ({
      subtitles: s.subtitles.map((line) =>
        line.id === id
          ? { ...line, problems: line.problems.includes(problem) ? line.problems : [...line.problems, problem] }
          : line
      )
    })),

  removeProblem: (id, problem) =>
    set((s) => ({
      subtitles: s.subtitles.map((line) =>
        line.id === id ? { ...line, problems: line.problems.filter((p) => p !== problem) } : line
      )
    })),

  appendSubtitleAiAttempts: (items) => {
    if (items.length === 0) return
    const validSeg = new Set(useScriptPoolStore.getState().segments.map((seg) => seg.id))
    const grouped = new Map<number, Omit<SubtitleAiAttempt, 'id' | 'createdAt'>[]>()
    for (const it of items) {
      const list = grouped.get(it.subtitleId) ?? []
      list.push(it.attempt)
      grouped.set(it.subtitleId, list)
    }
    set((s) => ({
      subtitles: s.subtitles.map((line) => {
        const list = grouped.get(line.id)
        if (!list?.length) return line
        let next = line
        for (const att of list) {
          const filteredIds = (att.matchedSegmentIds ?? []).filter((id) => validSeg.has(id))
          const full: SubtitleAiAttempt = {
            ...att,
            matchedSegmentIds: filteredIds,
            id: newAiAttemptId(),
            createdAt: Date.now()
          }
          next = pushAttempt(next, full)
        }
        return next
      })
    }))
  },

  removeSubtitleAiAttempt: (subtitleId, attemptId) =>
    set((s) => ({
      subtitles: s.subtitles.map((line) =>
        line.id !== subtitleId
          ? line
          : { ...line, aiAttempts: line.aiAttempts?.filter((a) => a.id !== attemptId) }
      )
    })),

  applySubtitleAiAttempt: (subtitleId, attemptId, confidenceThresholdPct) => {
    const validSeg = new Set(useScriptPoolStore.getState().segments.map((seg) => seg.id))
    set((s) => ({
      subtitles: s.subtitles.map((line) => {
        if (line.id !== subtitleId) return line
        const att = line.aiAttempts?.find((a) => a.id === attemptId)
        if (!att || !att.english.trim()) return line
        const filteredIds = (att.matchedSegmentIds ?? []).filter((id) => validSeg.has(id))
        const status = resolveStatusWhenApplyingAttempt(att, confidenceThresholdPct)
        const cand: CandidateMatch = {
          id: `from-attempt-${attemptId}`,
          segmentIds: filteredIds,
          text: att.english.trim(),
          confidence: att.confidence,
          source: 'ai'
        }
        return {
          ...line,
          english: att.english.trim(),
          matchedSegmentIds: filteredIds,
          confidence: att.confidence,
          status,
          candidates: [cand],
          problems: mergeAlignmentProblems([], att.problems),
          manuallyEdited: false
        }
      })
    }))
  },

  applyFullFileAIMatchBatch: (entries, confidenceThresholdPct) => {
    if (entries.length === 0) return
    const validSeg = new Set(useScriptPoolStore.getState().segments.map((seg) => seg.id))
    const byId = new Map(entries.map((e) => [e.subtitleId, e]))
    set((s) => ({
      subtitles: s.subtitles.map((line) => {
        const entry = byId.get(line.id)
        if (!entry) return line
        const primary = entry.primary
        const filteredIds = primary.matchedSegmentIds.filter((id) => validSeg.has(id))
        const topPct = confidenceToPercent(primary.confidence)
        let next: SubtitleLine = {
          ...line,
          english: primary.english.trim(),
          matchedSegmentIds: filteredIds,
          confidence: topPct,
          status: entry.status,
          candidates: entry.candidates,
          problems: mergeAlignmentProblems(line.problems, entry.problems),
          manuallyEdited: false
        }
        if (entry.attemptBestValidated) {
          const payload = buildAiAttemptPayloadFromWritableRow(entry.attemptBestValidated, {
            source: entry.attemptSource ?? 'initial',
            contextTier: entry.attemptContextTier,
            thresholdPct: confidenceThresholdPct,
            problems: entry.problems
          })
          const full: SubtitleAiAttempt = {
            ...payload,
            id: newAiAttemptId(),
            createdAt: Date.now(),
            matchedSegmentIds: filteredIds
          }
          next = pushAttempt(next, full)
        }
        return next
      })
    }))
  },

  applyRetryCoverageMatchBatch: (entries, confidenceThresholdPct) => {
    if (entries.length === 0) return
    const validSeg = new Set(useScriptPoolStore.getState().segments.map((seg) => seg.id))
    const byId = new Map(entries.map((e) => [e.subtitleId, e]))
    set((s) => ({
      subtitles: s.subtitles.map((line) => {
        const entry = byId.get(line.id)
        if (!entry) return line
        if (line.status === 'confirmed' || line.status === 'manual') return line
        const primary = entry.primary
        const filteredIds = primary.matchedSegmentIds.filter((id) => validSeg.has(id))
        const topPct = confidenceToPercent(primary.confidence)
        let next: SubtitleLine = {
          ...line,
          english: primary.english.trim(),
          matchedSegmentIds: filteredIds,
          confidence: topPct,
          status: entry.status,
          candidates: entry.candidates,
          problems: mergeAlignmentProblems(line.problems, entry.problems),
          manuallyEdited: false
        }
        if (entry.attemptBestValidated) {
          const payload = buildAiAttemptPayloadFromWritableRow(entry.attemptBestValidated, {
            source: entry.attemptSource ?? 'retry',
            contextTier: entry.attemptContextTier,
            thresholdPct: confidenceThresholdPct,
            problems: entry.problems
          })
          const full: SubtitleAiAttempt = {
            ...payload,
            id: newAiAttemptId(),
            createdAt: Date.now(),
            matchedSegmentIds: filteredIds
          }
          next = pushAttempt(next, full)
        }
        return next
      })
    }))
  },

  applyAlignmentReviewStates: (entries) => {
    if (entries.length === 0) return
    const byId = new Map(entries.map((e) => [e.subtitleId, e]))
    set((s) => ({
      subtitles: s.subtitles.map((line) => {
        const entry = byId.get(line.id)
        if (!entry) return line
        const cleared = entry.clearEnglish
          ? { english: '', matchedSegmentIds: [] as string[] }
          : {}
        return {
          ...line,
          ...cleared,
          confidence: 0,
          status: 'needs_review' as SubtitleStatus,
          candidates: entry.candidates?.length ? entry.candidates : line.candidates,
          problems: mergeAlignmentProblems(line.problems, entry.problems)
        }
      })
    }))
  },

  markAlignmentBatchNeedsReview: (subtitleIds) => {
    if (subtitleIds.length === 0) return
    const idSet = new Set(subtitleIds)
    const problem = 'ai_alignment:user_skipped_batch'
    set((s) => ({
      subtitles: s.subtitles.map((line) =>
        idSet.has(line.id)
          ? {
              ...line,
              confidence: 0,
              status: 'needs_review' as SubtitleStatus,
              problems: line.problems.includes(problem) ? line.problems : [...line.problems, problem]
            }
          : line
      )
    }))
  }
}))

export function selectCurrentSubtitle(state: SubtitleStoreState): SubtitleLine | null {
  const { subtitles, currentSubtitleId } = state
  if (subtitles.length === 0) return null
  if (currentSubtitleId != null) {
    const hit = subtitles.find((l) => l.id === currentSubtitleId)
    if (hit) return hit
  }
  return subtitles[0] ?? null
}
