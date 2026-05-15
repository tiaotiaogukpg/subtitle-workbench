import { create } from 'zustand'
import {
  confidenceToPercent,
  mergeAlignmentProblems,
  statusFromConfidencePct,
  type AlignmentMatchRow
} from '../lib/alignment'
import { initialSubtitleLines } from '../mocks/subtitles'
import type { CandidateMatch, SubtitleLine, SubtitleStatus } from '../types'
import { useScriptPoolStore } from './scriptPoolStore'

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
  /** 将预览中的 AI 对齐结果写入字幕（含 candidates）；不修改未出现在 rows 中的行。 */
  applyDeepSeekPreviewMatches: (rows: AlignmentMatchRow[]) => void
  /** 整文件对齐：写入 AI 英文 + 状态 + 可读 problems + 候选（含 source）。 */
  applyFullFileAIMatchBatch: (
    entries: Array<{
      subtitleId: number
      primary: AlignmentMatchRow
      status: SubtitleStatus
      problems: string[]
      candidates: CandidateMatch[]
    }>
  ) => void
  /** 标记需复查：不修改 english，可写入 candidates / problems。 */
  applyAlignmentReviewStates: (
    entries: Array<{
      subtitleId: number
      candidates?: CandidateMatch[]
      problems: string[]
    }>
  ) => void
}

export type SubtitleStore = SubtitleStoreState & SubtitleStoreActions

function resolveCurrentIdAfterListChange(list: SubtitleLine[], prevId: number | null): number | null {
  if (list.length === 0) return null
  if (prevId != null && list.some((l) => l.id === prevId)) return prevId
  return list[0]!.id
}

export const useSubtitleStore = create<SubtitleStore>((set, get) => ({
  subtitles: initialSubtitleLines,
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

  applyDeepSeekPreviewMatches: (rows) => {
    if (rows.length === 0) return
    const validSeg = new Set(useScriptPoolStore.getState().segments.map((seg) => seg.id))
    const grouped = new Map<number, AlignmentMatchRow[]>()
    for (const r of rows) {
      const filteredIds = r.matchedSegmentIds.filter((id) => validSeg.has(id))
      const row: AlignmentMatchRow = {
        ...r,
        matchedSegmentIds: filteredIds,
        english: r.english.trim()
      }
      if (!grouped.has(row.subtitleId)) grouped.set(row.subtitleId, [])
      grouped.get(row.subtitleId)!.push(row)
    }

    set((s) => {
      const idSet = new Set(s.subtitles.map((l) => l.id))
      let subtitles = s.subtitles
      for (const [subtitleId, list] of grouped) {
        if (!idSet.has(subtitleId)) continue
        const sorted = [...list].sort((a, b) => b.confidence - a.confidence)
        const primary = sorted[0]!
        const candidates: CandidateMatch[] = sorted.map((m) => ({
          id: crypto.randomUUID(),
          segmentIds: [...m.matchedSegmentIds],
          text: m.english.trim(),
          confidence: confidenceToPercent(m.confidence),
          groupId: m.groupId,
          source: 'ai' as const
        }))
        const topPct = candidates[0]?.confidence ?? confidenceToPercent(primary.confidence)
        const status: SubtitleStatus = statusFromConfidencePct(topPct)
        subtitles = subtitles.map((line) =>
          line.id === subtitleId
            ? {
                ...line,
                english: primary.english.trim(),
                matchedSegmentIds: [...primary.matchedSegmentIds],
                confidence: topPct,
                candidates,
                status,
                manuallyEdited: false
              }
            : line
        )
      }
      return { subtitles }
    })
  },

  applyFullFileAIMatchBatch: (entries) => {
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
        return {
          ...line,
          english: primary.english.trim(),
          matchedSegmentIds: filteredIds,
          confidence: topPct,
          status: entry.status,
          candidates: entry.candidates,
          problems: mergeAlignmentProblems(line.problems, entry.problems),
          manuallyEdited: false
        }
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
        return {
          ...line,
          confidence: 0,
          status: 'needs_review' as SubtitleStatus,
          candidates: entry.candidates?.length ? entry.candidates : line.candidates,
          problems: mergeAlignmentProblems(line.problems, entry.problems)
        }
      })
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
