import { create } from 'zustand'
import { initialSubtitleLines } from '../mocks/subtitles'
import type { SubtitleLine, SubtitleStatus } from '../types'

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
  replaceEnglish: (id: number, english: string) => void
  addProblem: (id: number, problem: string) => void
  removeProblem: (id: number, problem: string) => void
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

  replaceEnglish: (id, english) =>
    set((s) => ({
      subtitles: s.subtitles.map((line) =>
        line.id === id
          ? {
              ...line,
              english,
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
    }))
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
