import { app } from 'electron'
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_USER_SETTINGS } from '../shared/settingsDefaults'

export interface UserSettingsRecord {
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

const FILE_NAME = 'settings.json'

export function userSettingsFilePath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 仅接受白名单字段，忽略未知键，避免畸形 JSON 污染状态。 */
function sanitizePartial(raw: unknown): Partial<UserSettingsRecord> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: Partial<UserSettingsRecord> = {}

  if (typeof o.provider === 'string') out.provider = o.provider.slice(0, 120)
  if (typeof o.apiKey === 'string') out.apiKey = o.apiKey.slice(0, 4096)
  if (typeof o.model === 'string') out.model = o.model.slice(0, 200)

  if (typeof o.batchSize === 'number' && Number.isFinite(o.batchSize)) {
    out.batchSize = clampInt(o.batchSize, 1, 500)
  }
  if (typeof o.confidenceThreshold === 'number' && Number.isFinite(o.confidenceThreshold)) {
    out.confidenceThreshold = clampInt(o.confidenceThreshold, 0, 100)
  }
  if (typeof o.autoMarkHighConfidence === 'boolean') out.autoMarkHighConfidence = o.autoMarkHighConfidence

  if (o.subtitleOrder === 'chineseFirst' || o.subtitleOrder === 'englishFirst') {
    out.subtitleOrder = o.subtitleOrder
  }
  if (o.exportFormat === '.srt') out.exportFormat = '.srt'
  if (typeof o.separateLines === 'boolean') out.separateLines = o.separateLines

  if (o.theme === 'light' || o.theme === 'dark') out.theme = o.theme
  if (typeof o.fontSize === 'number' && Number.isFinite(o.fontSize)) {
    out.fontSize = clampInt(o.fontSize, 10, 32)
  }

  return out
}

export function mergeUserSettings(partial: Partial<UserSettingsRecord>): UserSettingsRecord {
  return { ...DEFAULT_USER_SETTINGS, ...partial } as UserSettingsRecord
}

export function readUserSettingsFromDisk(): UserSettingsRecord {
  const p = userSettingsFilePath()
  if (!existsSync(p)) return { ...DEFAULT_USER_SETTINGS }
  try {
    const text = readFileSync(p, 'utf8')
    const parsed: unknown = JSON.parse(text)
    return mergeUserSettings(sanitizePartial(parsed))
  } catch {
    return { ...DEFAULT_USER_SETTINGS }
  }
}

export function writeUserSettingsToDisk(settings: UserSettingsRecord): void {
  const p = userSettingsFilePath()
  const tmp = `${p}.tmp`
  const data = `${JSON.stringify(settings, null, 2)}\n`
  writeFileSync(tmp, data, 'utf8')
  try {
    if (existsSync(p)) unlinkSync(p)
  } catch {
    /* ignore */
  }
  renameSync(tmp, p)
}

export function validateAndMergeSettingsPayload(raw: unknown): UserSettingsRecord {
  return mergeUserSettings(sanitizePartial(raw))
}
