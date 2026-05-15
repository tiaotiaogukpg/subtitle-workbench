import { create } from 'zustand'
import {
  confidenceToPercent,
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
          groupId: m.groupId
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
