/// <reference types="vite/client" />

type AppSettingsState = {
  provider: string
  apiKey: string
  model: string
  batchSize: number
  confidenceThreshold: number
  autoMarkHighConfidence: boolean
  subtitleOrder: 'chineseFirst' | 'englishFirst'
  exportFormat: '.srt'
  separateLines: boolean
  theme: 'light' | 'dark'
  fontSize: number
}

declare global {
  interface Window {
    bilingualSubtitleAligner?: {
      appName: string
      phase: string
      getUserSettings: () => Promise<{ settings: AppSettingsState; loadedFromDisk: boolean }>
      setUserSettings: (settings: AppSettingsState) => Promise<AppSettingsState>
      testDeepSeekConnection: (
        apiKey: string,
        model: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      readClipboardText: () => Promise<string>
    }
  }
}

export {}
