/**
 * Subtitle Overlay Window — independent transparent window at screen bottom.
 *
 * Displays AI responses as game-like subtitles. Completely separate from
 * the main pet window. Uses a second BrowserWindow with full transparency
 * and mouse passthrough.
 */

import type { Rectangle } from 'electron'

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'

import { baseUrl, getElectronMainDirname, load } from '../../libs/electron/location'

const SUBTITLE_WINDOW_HEIGHT = 160
const SUBTITLE_BOTTOM_MARGIN = 70 // above taskbar

let win: BrowserWindow | null = null

function getWorkArea(): Rectangle {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  return display.workArea
}

export async function createSubtitleWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win

  const workArea = getWorkArea()
  const width = Math.min(Math.round(workArea.width * 0.65), 1200)
  const x = workArea.x + Math.round(workArea.width * 0.15) // centered right-ish
  const y = workArea.y + workArea.height - SUBTITLE_WINDOW_HEIGHT - SUBTITLE_BOTTOM_MARGIN

  win = new BrowserWindow({
    x,
    y,
    width,
    height: SUBTITLE_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    type: 'tool',
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'preload', 'index.mjs'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setVisibleOnAllWorkspaces(true)

  await load(win, `${baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'))}#/subtitle`)

  win.on('closed', () => { win = null })

  return win
}

export function getSubtitleWindow(): BrowserWindow | null {
  if (win && !win.isDestroyed()) return win
  return null
}

export function setupSubtitleIPC() {
  // Global hotkey: Ctrl+Alt+Space → show subtitle input
  globalShortcut.register('Ctrl+Alt+Space', () => {
    const w = getSubtitleWindow()
    if (w && !w.isDestroyed()) {
      if (w.isFocused()) {
        w.webContents.send('subtitle:hide-input')
      }
      else {
        w.setIgnoreMouseEvents(false)
        w.setFocusable(true)
        w.focus()
        w.webContents.send('subtitle:show-input')
      }
    }
  })

  ipcMain.handle('subtitle:show', async (_e, text: string) => {
    const w = getSubtitleWindow()
    if (w) w.webContents.send('subtitle:display', text)
  })

  ipcMain.handle('subtitle:hide', async () => {
    const w = getSubtitleWindow()
    if (w) w.webContents.send('subtitle:hide')
  })

  ipcMain.handle('subtitle:show-input', async () => {
    const w = getSubtitleWindow()
    if (w) {
      w.setIgnoreMouseEvents(false)
      w.setFocusable(true)
      w.focus()
      w.webContents.send('subtitle:show-input')
    }
  })

  ipcMain.handle('subtitle:hide-input', async () => {
    const w = getSubtitleWindow()
    if (w) {
      w.setIgnoreMouseEvents(true, { forward: true })
      w.setFocusable(false)
      w.webContents.send('subtitle:hide-input')
    }
  })

  // Forward chat message from subtitle window to main renderer
  ipcMain.handle('subtitle:send-message', async (_e, text: string) => {
    // Get the main window and forward the message
    const mainWindow = BrowserWindow.getAllWindows().find(
      w => !w.isDestroyed() && w !== win && w.getTitle() === 'AIRI',
    )
    if (mainWindow) {
      mainWindow.webContents.send('subtitle:incoming-message', text)
    }
    return { ok: true }
  })
}
