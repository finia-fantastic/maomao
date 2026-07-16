/**
 * Game Learning Service — teaching mode key recorder.
 *
 * When teaching mode is active, listens to physical keyboard events
 * via uiohook-napi and records key press/release with timestamps.
 * Injected/AI-sent events (LLKHF_INJECTED) are NOT recorded.
 */

import type { DemonstratedAction } from '../../../../shared/eventa/game-learning'

import { ipcMain } from 'electron'
import type { UiohookKeyboardEvent } from 'uiohook-napi'
import { uIOhook } from 'uiohook-napi'

/** Map uiohook keycodes to readable names for game keys. */
const KEY_NAMES: Record<number, string> = {
  17: 'w', 30: 'a', 31: 's', 32: 'd',
  57: 'space', 28: 'enter', 1: 'esc',
  18: 'e', 16: 'q', 33: 'f', 19: 'r',
  15: 'tab', 42: 'shift', 29: 'ctrl', 56: 'alt',
  2: '1', 3: '2', 4: '3', 5: '4', 6: '5',
  200: 'up', 208: 'down', 203: 'left', 205: 'right',
  50: 'm',
}

function keycodeToName(code: number): string {
  return KEY_NAMES[code] ?? `key_${code}`
}

interface TeachingState {
  active: boolean
  episodeId: string
  gameId: string
  startedAt: number
  steps: Array<{
    action: DemonstratedAction
    capturedAt: number
  }>
  pendingKeyDown: { key: string, time: number } | null
}

const state: TeachingState = {
  active: false,
  episodeId: '',
  gameId: 'luoke',
  startedAt: 0,
  steps: [],
  pendingKeyDown: null,
}

/**
 * Whether the uiohook event came from a real physical keyboard
 * (not from our own GameActionExecutor injection).
 *
 * uiohook-napi does not expose the LLKHF_INJECTED flag directly,
 * but we can use a guard pattern: the GameActionExecutor sets
 * ManualOverrideGuard.isInjecting=true before injecting, and we
 * skip recording when isInjecting is true.
 *
 * For now we use a simpler approach: the guard module-level flag.
 */
let isAiInjecting = false

export function setAiInjecting(v: boolean) {
  isAiInjecting = v
}

function onKeyDown(e: UiohookKeyboardEvent) {
  if (!state.active || isAiInjecting) return
  const name = keycodeToName(e.keycode)
  state.pendingKeyDown = { key: name, time: Date.now() }
  console.log(`[Teaching] key down: ${name}`)
}

function onKeyUp(e: UiohookKeyboardEvent) {
  if (!state.active || isAiInjecting) return
  const name = keycodeToName(e.keycode)
  const down = state.pendingKeyDown
  const durationMs = down && down.key === name ? Date.now() - down.time : 80
  state.pendingKeyDown = null

  const action: DemonstratedAction = {
    type: durationMs > 300 ? 'key_hold' : 'key_tap',
    key: name,
    durationMs,
  }

  state.steps.push({ action, capturedAt: Date.now() })
  console.log(`[Teaching] key up: ${name} duration=${durationMs}ms totalSteps=${state.steps.length}`)
}

export function setupGameLearningService() {
  // Register keyboard listeners
  uIOhook.on('keydown', onKeyDown)
  uIOhook.on('keyup', onKeyUp)

  // IPC: start teaching mode
  ipcMain.handle('game-teaching:start', (_e, p?: { title?: string }) => {
    state.active = true
    state.episodeId = `teach-${Date.now()}`
    state.startedAt = Date.now()
    state.steps = []
    state.pendingKeyDown = null
    console.log(`[Teaching] episode started: ${state.episodeId} title="${p?.title ?? ''}"`)
    return { ok: true, episodeId: state.episodeId }
  })

  // IPC: stop teaching mode
  ipcMain.handle('game-teaching:stop', () => {
    state.active = false
    const count = state.steps.length
    console.log(`[Teaching] episode stopped: ${state.episodeId} steps=${count}`)
    return {
      ok: true,
      episodeId: state.episodeId,
      gameId: state.gameId,
      startedAt: state.startedAt,
      steps: state.steps,
      stepCount: count,
    }
  })

  // IPC: get current teaching state
  ipcMain.handle('game-teaching:state', () => ({
    active: state.active,
    episodeId: state.episodeId,
    gameId: state.gameId,
    startedAt: state.startedAt,
    stepCount: state.steps.length,
    steps: state.steps.slice(-20), // last 20 for display
  }))

  // IPC: mark last step success/failure
  ipcMain.handle('game-teaching:mark', async (_e, p: { index: number, success: boolean, note?: string }) => {
    const step = state.steps[p.index]
    if (!step) return { ok: false as const, error: 'Step not found' }
    ;(step as any).success = p.success
    if (p.note) (step as any).userNote = p.note
    return { ok: true as const }
  })
}
