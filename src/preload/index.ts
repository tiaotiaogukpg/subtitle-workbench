import { contextBridge, ipcRenderer } from 'electron'

type UserSettingsGetResult = {
  settings: Record<string, unknown>
  loadedFromDisk: boolean
}

const api = {
  appName: 'Bilingual Subtitle Aligner',
  phase: 'phase-1-ui-skeleton',
  getUserSettings: (): Promise<UserSettingsGetResult> => ipcRenderer.invoke('settings:get'),
  setUserSettings: (settings: Record<string, unknown>): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:set', settings),
  testDeepSeekConnection: (apiKey: string, model: string) =>
    ipcRenderer.invoke('deepseek:testConnection', { apiKey, model }) as Promise<
      { ok: true } | { ok: false; error: string }
    >,
  readClipboardText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
  alignDeepSeekBatch: (payload: {
    model: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  }) =>
    ipcRenderer.invoke('deepseek:alignBatch', payload) as Promise<
      | { ok: true; rawText: string; latencyMs: number; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
      | { ok: false; error: string }
    >
}

contextBridge.exposeInMainWorld('bilingualSubtitleAligner', api)
