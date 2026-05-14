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
      alignDeepSeekBatch: (payload: {
        model: string
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      }) => Promise<
        | { ok: true; rawText: string; latencyMs: number; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
        | { ok: false; error: string }
      >
    }
  }
}

export {}
