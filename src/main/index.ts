import { app, BrowserWindow, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
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

  Menu.setApplicationMenu(buildApplicationMenu())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
