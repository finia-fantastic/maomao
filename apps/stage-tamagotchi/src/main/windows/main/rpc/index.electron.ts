import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { WindowAuthManager } from '../../../services/airi/auth'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { GodotStageManager } from '../../../services/airi/godot-stage'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { NoticeWindowManager } from '../../notice'
import type { OnboardingWindowManager } from '../../onboarding'
import type { SettingsWindowManager } from '../../settings'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronCenterMainWindow, electronOpenChat, electronOpenMainDevtools, electronOpenSettings, noticeWindowEventa } from '../../../../shared/eventa'
import { createAuthService } from '../../../services/airi/auth'
import { createGodotStageService } from '../../../services/airi/godot-stage'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createOnboardingService } from '../../../services/airi/onboarding'
import { createVocabDbService } from '../../../services/airi/vocab-db'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { captureScreenToDataUrl } from '../../../services/electron/screen-capture'
import { createMemoryService } from '../../../services/memory'
import { toggleWindowShow } from '../../shared'
import { centerWindowOnDisplay } from '../../shared/display'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupMainWindowElectronInvokes(params: {
  window: BrowserWindow
  settingsWindow: SettingsWindowManager
  chatWindow: () => Promise<BrowserWindow>
  widgetsManager: WidgetsWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  serverChannel: ServerChannel
  godotStageManager: GodotStageManager
  mcpStdioManager: McpStdioManager
  i18n: I18n
  onboardingWindowManager: OnboardingWindowManager
  windowAuthManager: WindowAuthManager
}) {
  // TODO: once we refactored eventa to support window-namespaced contexts,
  // we can remove the setMaxListeners call below since eventa will be able to dispatch and
  // manage events within eventa's context system.
  ipcMain.setMaxListeners(0)

  const { context } = createContext(ipcMain, params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, serverChannel: params.serverChannel, i18n: params.i18n })
  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createAutoUpdaterService({ context, window: params.window, service: params.autoUpdater })
  createMcpServersService({ context, manager: params.mcpStdioManager })
  createGodotStageService({ context, manager: params.godotStageManager, window: params.window })
  createOnboardingService({ context, onboardingWindowManager: params.onboardingWindowManager, mainWindow: params.window })
  createAuthService({ context, window: params.window, windowAuthManager: params.windowAuthManager })
  createVocabDbService({ context })
  createMemoryService(context)

  defineInvokeHandler(context, electronCenterMainWindow, () => centerWindowOnDisplay(params.window))
  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenSettings, payload => params.settingsWindow.openWindow(payload?.route))
  defineInvokeHandler(context, electronOpenChat, async () => toggleWindowShow(await params.chatWindow()))
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))

  // Screen capture via desktopCapturer — no system dialog needed
  ipcMain.handle('screen-capture:capture', async () => {
    const dataUrl = await captureScreenToDataUrl()
    return { dataUrl }
  })

  // Get main pet window screen bounds for self-masking in vision screenshots.
  // Returns the window's position and size in physical screen pixels.
  // Used by the renderer to paint a black mask over the pet's own window
  // so the vision model doesn't see and comment on itself.
  ipcMain.handle('get-pet-window-bounds', () => {
    return params.window.getBounds()
  })

  // Check if vocab app is running via local socket ping.
  ipcMain.handle('vocab:is-running', async () => {
    try {
      const net = await import('node:net')
      const running = await new Promise<boolean>((resolve) => {
        const sock = new net.Socket()
        sock.setTimeout(1000)
        sock.connect(47631, '127.0.0.1', () => {
          sock.write('{"command":"ping"}\n')
        })
        sock.on('data', (data: Buffer) => {
          sock.destroy()
          resolve(data.toString().includes('"running":true'))
        })
        sock.on('error', () => resolve(false))
        sock.on('timeout', () => { sock.destroy(); resolve(false) })
      })
      return { running }
    }
    catch {
      return { running: false }
    }
  })

  // Save AI-generated image to temp directory, return airi-image:// URL.
  // NOTICE: We use a custom Electron protocol (airi-image://) instead of file://
  // because DOMPurify strips file:// src attributes and Chromium blocks file://
  // from non-file origins (the renderer loads from http://localhost:5173).
  // The protocol is registered in main/index.ts via protocol.registerSchemesAsPrivileged + protocol.handle.
  ipcMain.handle('image:save-temp', async (_event, payload: { base64: string, name: string }) => {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs')
      const { join } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const dir = join(tmpdir(), 'airi-images')
      mkdirSync(dir, { recursive: true })
      const filePath = join(dir, payload.name)
      writeFileSync(filePath, Buffer.from(payload.base64, 'base64'))
      return { fileUrl: `airi-image://${encodeURIComponent(payload.name)}` }
    }
    catch { return { fileUrl: null } }
  })

  // Send show command to the running vocab app.
  ipcMain.handle('vocab:show', async () => {
    try {
      const net = await import('node:net')
      const result = await new Promise<string>((resolve) => {
        const sock = new net.Socket()
        sock.setTimeout(2000)
        sock.connect(47631, '127.0.0.1', () => {
          sock.write('{"command":"show"}\n')
        })
        sock.on('data', (data: Buffer) => {
          sock.destroy()
          resolve(data.toString())
        })
        sock.on('error', () => resolve('{"ok":false}'))
        sock.on('timeout', () => { sock.destroy(); resolve('{"ok":false}') })
      })
      return JSON.parse(result)
    }
    catch {
      return { ok: false }
    }
  })

  // Quick memory store for the LLM tool (bypasses eventa, uses singleton DB directly).
  // The LLM calls this after summarizing web content or when the user says "记住".
  ipcMain.handle('memory:store-tool', async (_event, payload: {
    subject: string
    content: string
    type?: string
    importance?: number
    projectId?: string
  }) => {
    try {
      const { getMemoryDatabase } = await import('../../../services/memory/MemoryDatabase')
      const { app } = await import('electron')
      const { storeMemory } = await import('../../../services/memory/MemoryDatabase')

      const db = getMemoryDatabase(app.getPath('userData'))

      const validTypes = ['profile', 'preference', 'project', 'decision', 'relationship', 'episode', 'commitment', 'correction', 'temporary'] as const
      const type = validTypes.includes(payload.type as any) ? payload.type as typeof validTypes[number] : 'episode'

      const memoryKey = `${type}:${payload.subject.replace(/\s+/g, ' ').slice(0, 60).toLowerCase()}`

      const record = storeMemory(db, {
        userId: 'default-user',
        projectId: payload.projectId ?? null,
        type,
        memoryKey,
        subject: payload.subject.slice(0, 80),
        content: payload.content,
        importance: payload.importance ?? 0.7,
        confidence: 0.9,
      })

      return { ok: true, id: record.id }
    }
    catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })

  // Fetch a URL's text content (webpage, article, etc.) via Node.js fetch.
  // Strips HTML tags and returns the extracted text for LLM processing.
  // Used by the fetch_url tool to let users share links for memory storage.
  ipcMain.handle('url:fetch', async (_event, payload: { url: string }) => {
    const MAX_CONTENT_LENGTH = 50_000
    const FETCH_TIMEOUT_MS = 15_000

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const url = payload.url?.trim()
      if (!url)
        return { ok: false, error: 'URL is empty' }

      // Build request options to mimic a browser
      const urlObj = new URL(url)
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
      }

      // Use global fetch (Node 18+) which handles both http: and https:
      const response = await fetch(url, options)
      clearTimeout(timer)

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status} ${response.statusText}` }
      }

      const html = await response.text()

      // Strip HTML tags, scripts, styles; extract readable text
      const text = stripHtml(html).slice(0, MAX_CONTENT_LENGTH)
      const title = extractTitle(html) ?? urlObj.hostname

      return {
        ok: true,
        title,
        url,
        text,
        textLength: text.length,
        truncated: text.length >= MAX_CONTENT_LENGTH,
      }
    }
    catch (err: any) {
      clearTimeout(timer)
      if (err?.name === 'AbortError')
        return { ok: false, error: `Fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s` }
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
}

// ---- HTML text extraction helpers (used by url:fetch handler) ----

/** Extract the <title> tag content from an HTML string. */
function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return match?.[1]?.trim() ?? null
}

/** Strip HTML tags, scripts, styles, and collapse whitespace to readable text. */
function stripHtml(html: string): string {
  // Remove scripts and styles completely
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))

  // Collapse whitespace and trim
  text = text.replace(/\s+/g, ' ').trim()

  return text
}
