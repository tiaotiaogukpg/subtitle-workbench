import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 仅影响界面展示；不改变对齐 pipeline 与数据结构。 */
export interface UiSettingsState {
  /** 开启后显示 span 诊断、原始 JSON、候选组等开发者信息。 */
  debugMode: boolean
  setDebugMode: (next: boolean) => void
}

export const useUiSettingsStore = create<UiSettingsState>()(
  persist(
    (set) => ({
      debugMode: false,
      setDebugMode: (debugMode) => set({ debugMode })
    }),
    { name: 'subtitle-aligner-ui-settings' }
  )
)
