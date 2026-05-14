import { create } from 'zustand'
import type { ScriptPoolListFilter, ScriptSegment } from '../types'

export interface ScriptPoolStoreState {
  segments: ScriptSegment[]
  selectedSegmentId: string | null
  listFilter: ScriptPoolListFilter
}

export interface ScriptPoolStoreActions {
  setSegments: (segments: ScriptSegment[]) => void
  selectSegment: (id: string | null) => void
  setListFilter: (filter: ScriptPoolListFilter) => void
  clear: () => void
}

export type ScriptPoolStore = ScriptPoolStoreState & ScriptPoolStoreActions

export const useScriptPoolStore = create<ScriptPoolStore>((set) => ({
  segments: [],
  selectedSegmentId: null,
  listFilter: 'all',

  setSegments: (segments) => set({ segments, selectedSegmentId: null, listFilter: 'all' }),

  selectSegment: (id) => set({ selectedSegmentId: id }),

  setListFilter: (listFilter) => set({ listFilter }),

  clear: () => set({ segments: [], selectedSegmentId: null, listFilter: 'all' })
}))

/** 与当前列表筛选条件匹配的片段（不改变 segments 顺序）。 */
export function filterScriptSegmentsForList(
  segments: ScriptSegment[],
  listFilter: ScriptPoolListFilter
): ScriptSegment[] {
  if (listFilter === 'all') return segments
  if (listFilter === 'english') return segments.filter((s) => s.language === 'english')
  if (listFilter === 'mixed') return segments.filter((s) => s.language === 'mixed')
  if (listFilter === 'chinese') return segments.filter((s) => s.language === 'chinese')
  return segments
}
