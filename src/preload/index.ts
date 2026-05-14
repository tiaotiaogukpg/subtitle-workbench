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
  readClipboardText: (): Promise<string> => ipcRenderer.invoke('clipboard:readText')
}

contextBridge.exposeInMainWorld('bilingualSubtitleAligner', api)
