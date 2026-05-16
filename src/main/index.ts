import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerDeepSeekIpc } from './deepseekIpc'
import { registerUserSettingsIpc } from './settingsIpc'

/** electron-vite 产出为 `index.mjs`，旧路径 `index.js` 会导致 preload 未加载、桥接 API 不存在。 */
function resolvePreloadPath(): string {
  const dir = join(__dirname, '../preload')
  const mjs = join(dir, 'index.mjs')
  const js = join(dir, 'index.js')
  if (existsSync(mjs)) return mjs
  if (existsSync(js)) return js
  return mjs
}

function registerClipboardIpc(): void {
  ipcMain.removeHandler('clipboard:readText')
  ipcMain.handle('clipboard:readText', () => clipboard.readText())
}

function buildApplicationMenu(): Menu {
  const darwin = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(darwin
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help' }
  ]
  return Menu.buildFromTemplate(template)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 704,
    minWidth: 840,
    minHeight: 560,
    title: 'Bilingual Subtitle Aligner',
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.bilingual.subtitle.aligner')
  nativeTheme.themeSource = 'dark'

  registerDeepSeekIpc()
  registerUserSettingsIpc()
  registerClipboardIpc()

  Menu.setApplicationMenu(buildApplicationMenu())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
