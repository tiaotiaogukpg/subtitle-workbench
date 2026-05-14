import { create } from 'zustand'
import type { SubtitleLine } from '../types'
import { useSubtitleStore } from './subtitleStore'

const MAX_UNDO = 10

export type EditSubtitleTextAction = {
  type: 'editSubtitleText'
  subtitleId: number
  field: 'chinese' | 'english'
  before: string
  after: string
}

interface HistoryStoreState {
  undoStack: EditSubtitleTextAction[]
  redoStack: EditSubtitleTextAction[]
}

interface HistoryStoreActions {
  /** O(1)：清空撤销/重做；导入 SRT 等场景调用，不做整表快照。 */
  clearUndoHistory: () => void
  /** 用户完成一次编辑（blur）且内容相对 focus 时变化时调用。 */
  recordTextEditIfChanged: (payload: {
    subtitleId: number
    field: 'chinese' | 'english'
    before: string
    after: string
  }) => void
  undo: () => void
  redo: () => void
}

export type HistoryStore = HistoryStoreState & HistoryStoreActions

function pushTrimmed(stack: EditSubtitleTextAction[], action: EditSubtitleTextAction): EditSubtitleTextAction[] {
  const next = [...stack, action]
  while (next.length > MAX_UNDO) next.shift()
  return next
}

function applyFieldToSubtitle(id: number, field: 'chinese' | 'english', value: string): void {
  const patch: Partial<SubtitleLine> = {
    [field]: value,
    manuallyEdited: true,
    status: 'manual'
  }
  if (field === 'english') {
    patch.matchedSegmentIds = []
  }
  useSubtitleStore.getState().updateSubtitle(id, patch)
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  undoStack: [],
  redoStack: [],

  clearUndoHistory: () => set({ undoStack: [], redoStack: [] }),

  recordTextEditIfChanged: ({ subtitleId, field, before, after }) => {
    if (before === after) return
    const action: EditSubtitleTextAction = {
      type: 'editSubtitleText',
      subtitleId,
      field,
      before,
      after
    }
    set((s) => ({
      undoStack: pushTrimmed(s.undoStack, action),
      redoStack: []
    }))
  },

  undo: () => {
    const { undoStack, redoStack } = get()
    if (undoStack.length === 0) return
    const action = undoStack[undoStack.length - 1]!
    applyFieldToSubtitle(action.subtitleId, action.field, action.before)
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, action]
    })
  },

  redo: () => {
    const { undoStack, redoStack } = get()
    if (redoStack.length === 0) return
    const action = redoStack[redoStack.length - 1]!
    applyFieldToSubtitle(action.subtitleId, action.field, action.after)
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: pushTrimmed(undoStack, action)
    })
  }
}))
