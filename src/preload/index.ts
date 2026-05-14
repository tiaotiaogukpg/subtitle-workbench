import { contextBridge } from 'electron'

const api = {
  appName: 'Bilingual Subtitle Aligner',
  phase: 'phase-1-ui-skeleton'
}

contextBridge.exposeInMainWorld('bilingualSubtitleAligner', api)
