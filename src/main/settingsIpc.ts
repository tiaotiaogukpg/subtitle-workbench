import { existsSync } from 'node:fs'
import { ipcMain } from 'electron'
import { readUserSettingsFromDisk, userSettingsFilePath, validateAndMergeSettingsPayload, writeUserSettingsToDisk } from './userSettingsFile'

export function registerUserSettingsIpc(): void {
  ipcMain.removeHandler('settings:get')
  ipcMain.removeHandler('settings:set')

  ipcMain.handle('settings:get', () => {
    const loadedFromDisk = existsSync(userSettingsFilePath())
    return {
      settings: readUserSettingsFromDisk(),
      loadedFromDisk
    }
  })

  ipcMain.handle('settings:set', (_event, raw: unknown) => {
    const merged = validateAndMergeSettingsPayload(raw)
    writeUserSettingsToDisk(merged)
    return merged
  })
}
