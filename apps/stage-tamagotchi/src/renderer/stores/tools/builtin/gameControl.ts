import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

// UiohookKey codes for common game keys (used in software mode)
const KEY_MAP: Record<string, number> = {
  // Movement
  w: 17,
  a: 30,
  s: 31,
  d: 32,
  up: 0xC8,
  down: 0xD0,
  left: 0xCB,
  right: 0xCD,
  // Actions
  space: 57,
  enter: 28,
  esc: 1,
  tab: 15,
  shift: 42,
  ctrl: 29,
  alt: 56,
  // Numbers
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
  8: 9,
  9: 10,
  0: 11,
  // Letters
  e: 18,
  q: 16,
  r: 19,
  f: 33,
  z: 44,
  x: 45,
  c: 46,
  g: 34,
  h: 35,
  i: 23,
  j: 36,
  k: 37,
  l: 38,
  m: 50,
  n: 49,
  o: 24,
  p: 25,
  t: 20,
  u: 22,
  v: 47,
  b: 48,
  y: 21,
}

const gameControlParams = z.object({
  action: z.enum(['press_key', 'key_sequence', 'wait', 'mouse_click', 'mouse_move', 'start', 'stop']).describe(
    'Action type:\n'
    + '- press_key: press and release a single key\n'
    + '- key_sequence: press multiple keys in order\n'
    + '- wait: pause between actions (milliseconds)\n'
    + '- mouse_click: click left/right/middle mouse\n'
    + '- mouse_move: move mouse to absolute screen coordinates\n'
    + '- start: begin game control (target window title optional)\n'
    + '- stop: end game control',
  ),
  key: z.string().describe('For press_key: key name (w/a/s/d/space/enter/esc/e/q/f/1-9 etc.)').optional(),
  keys: z.string().describe('For key_sequence: comma-separated key names (e.g. "w,w,w,space")').optional(),
  duration: z.number().describe('For wait: milliseconds to wait. For press_key: hold duration (default 50ms).').optional(),
  button: z.number().min(1).max(3).describe('For mouse_click: 1=left, 2=right, 3=middle').optional(),
  target_window: z.string().describe('For start: game window title to focus (optional).').optional(),
  x: z.number().describe('For mouse_move: target X screen coordinate').optional(),
  y: z.number().describe('For mouse_move: target Y screen coordinate').optional(),
  hardware: z.boolean().describe('Use Arduino hardware for input injection (bypasses anti-cheat). Auto-detected if omitted.').optional(),
})

const GAME_CONTROL_STARTED_KEY = '__game_control_started'

/** Tested hardware keys — these are known to work with the Arduino firmware. */
const VALID_HARDWARE_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'space',
  'enter',
  'esc',
  'tab',
  'shift',
  'ctrl',
  'alt',
  'up',
  'down',
  'left',
  'right',
  'e',
  'q',
  'r',
  'f',
  'z',
  'x',
  'c',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  't',
  'u',
  'v',
  'b',
  'y',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
])

/**
 * Check whether the Arduino hardware bridge is currently connected.
 */
async function isArduinoConnected(): Promise<boolean> {
  try {
    const ipc = (window as any).electron.ipcRenderer
    const result = await ipc.invoke('arduino:status')
    return result?.connected === true
  }
  catch {
    return false
  }
}

/**
 * Send a command through the Arduino hardware bridge.
 * Returns { ok, error } to mirror the software path.
 */
async function arduinoExecute(input: {
  action: string
  key?: string
  keys?: string
  duration?: number
  button?: number
  x?: number
  y?: number
}): Promise<{ ok: boolean, error?: string, results?: Array<{ success: boolean, actionId: string, error?: string }> }> {
  const ipc = (window as any).electron.ipcRenderer
  const results: Array<{ success: boolean, actionId: string, error?: string }> = []

  switch (input.action) {
    case 'press_key': {
      const keyName = (input.key ?? 'w').toLowerCase()
      if (!VALID_HARDWARE_KEYS.has(keyName)) {
        return { ok: false, error: `Hardware mode does not support key: "${keyName}". Supported: ${[...VALID_HARDWARE_KEYS].join(', ')}` }
      }
      const r = await ipc.invoke('arduino:key', { key: keyName, action: 'tap' })
      results.push({ success: r.ok, actionId: `arduino-${keyName}`, error: r.error })
      return { ok: r.ok, error: r.error, results }
    }
    case 'key_sequence': {
      const keys = (input.keys ?? 'w').split(',').map(k => k.trim().toLowerCase())
      for (const k of keys) {
        if (!VALID_HARDWARE_KEYS.has(k)) {
          return { ok: false, error: `Hardware mode does not support key: "${k}"` }
        }
        const r = await ipc.invoke('arduino:key', { key: k, action: 'tap' })
        results.push({ success: r.ok, actionId: `arduino-${k}`, error: r.error })
        if (!r.ok)
          return { ok: false, error: r.error, results }
        // Brief gap between keys in a sequence
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      return { ok: true, results }
    }
    case 'wait':
      await new Promise(resolve => setTimeout(resolve, input.duration ?? 500))
      return { ok: true, results: [] }
    case 'mouse_click': {
      const btnMap: Record<number, 'left' | 'right' | 'middle'> = { 1: 'left', 2: 'right', 3: 'middle' }
      const btn = btnMap[input.button ?? 1]
      const r = await ipc.invoke('arduino:mouse-click', { button: btn })
      results.push({ success: r.ok, actionId: `arduino-click-${btn}`, error: r.error })
      return { ok: r.ok, error: r.error, results }
    }
    case 'mouse_move': {
      if (input.x == null || input.y == null)
        return { ok: false, error: 'Need x, y for mouse_move' }
      const r = await ipc.invoke('arduino:mouse-move', { x: input.x, y: input.y })
      results.push({ success: r.ok, actionId: `arduino-move-${input.x}-${input.y}`, error: r.error })
      return { ok: r.ok, error: r.error, results }
    }
    default:
      return { ok: false, error: `Unknown action for hardware: ${input.action}` }
  }
}

/**
 * Execute actions via the software path (uiohook / PowerShell injection).
 */
async function softwareExecute(input: {
  action: string
  key?: string
  keys?: string
  duration?: number
  button?: number
  x?: number
  y?: number
}): Promise<{ ok: boolean, error?: string, results?: Array<{ success: boolean, actionId: string, error?: string }> }> {
  const ipc = (window as any).electron.ipcRenderer

  // Build action plan
  const actions: Array<{ type: string, params: Record<string, unknown> }> = []

  switch (input.action) {
    case 'press_key': {
      const keyName = (input.key ?? 'w').toLowerCase()
      const keycode = KEY_MAP[keyName]
      if (keycode == null)
        return { ok: false, error: `Unknown key: "${input.key}". Available: ${Object.keys(KEY_MAP).join(', ')}` }
      actions.push({
        type: 'key_press',
        params: { key: keycode, durationMs: input.duration ?? 80 },
      })
      break
    }
    case 'key_sequence': {
      const keys = (input.keys ?? 'w').split(',').map(k => k.trim().toLowerCase())
      for (const k of keys) {
        const keycode = KEY_MAP[k]
        if (keycode == null)
          return { ok: false, error: `Unknown key: "${k}"` }
        actions.push({
          type: 'key_press',
          params: { key: keycode, durationMs: 60 },
        })
      }
      break
    }
    case 'wait':
      actions.push({ type: 'wait', params: { durationMs: input.duration ?? 500 } })
      break
    case 'mouse_click':
      actions.push({ type: 'mouse_click', params: { button: input.button ?? 1 } })
      break
    case 'mouse_move': {
      if (input.x == null || input.y == null)
        return { ok: false, error: 'Need x, y for mouse_move' }
      actions.push({ type: 'mouse_move', params: { x: input.x, y: input.y } })
      break
    }
  }

  return ipc.invoke('game-control:execute', {
    description: `${input.action} ${input.key ?? input.keys ?? ''}`,
    actions,
  })
}

/**
 * Game control tool — allows the AI to directly press keyboard keys,
 * click the mouse, and control games in real time.
 *
 * Supports two modes:
 * - **Hardware** (Arduino Leonardo R3): sends commands over serial to an
 *   ATmega32U4 that injects genuine USB HID events. This bypasses anti-cheat
 *   systems that block software-level keystroke injection.
 * - **Software** (uiohook-napi / PowerShell): injects keystrokes at the OS
 *   level via Win32 SendInput / keybd_event APIs.
 */
async function executeGameControl(input: {
  action: string
  key?: string
  keys?: string
  duration?: number
  button?: number
  target_window?: string
  x?: number
  y?: number
  hardware?: boolean
}): Promise<string> {
  try {
    const ipc = (window as any).electron.ipcRenderer

    // For start/stop, use the simpler IPC approach
    if (input.action === 'start') {
      const result = await ipc.invoke('game-control:start', {
        mode: 'single_step',
        targetWindowTitle: input.target_window ?? '',
      })
      if (result?.ok) {
        ;(window as any)[GAME_CONTROL_STARTED_KEY] = true
        // Also report Arduino status on start
        const hwConnected = await isArduinoConnected()
        const hwNote = hwConnected ? ' Arduino 硬件已连接，将使用硬件模式。' : ''
        return `游戏控制已启动。${hwNote}可以开始操作了。`
      }
      return `启动失败：${result?.error ?? '未知'}`
    }

    if (input.action === 'stop') {
      ;(window as any)[GAME_CONTROL_STARTED_KEY] = false
      await ipc.invoke('game-control:stop')
      return '游戏控制已停止。'
    }

    // Determine whether to use hardware mode
    // Priority: explicit `hardware` param > auto-detect Arduino connection
    const useHardware = input.hardware === true || (input.hardware !== false && await isArduinoConnected())

    if (useHardware && input.action !== 'start' && input.action !== 'stop') {
      // Hardware path: send commands directly to Arduino
      const result = await arduinoExecute({
        action: input.action,
        key: input.key,
        keys: input.keys,
        duration: input.duration,
        button: input.button,
        x: input.x,
        y: input.y,
      })

      if (result?.ok)
        return `[硬件] 操作完成：${input.action} ${input.key ?? input.keys ?? ''}`
      return `[硬件] 操作失败：${result?.error ?? '未知错误'}`
    }

    // Software path: use uiohook / PowerShell injection

    // Auto-start if not started yet
    if (!(window as any)[GAME_CONTROL_STARTED_KEY]) {
      await ipc.invoke('game-control:start', { mode: 'single_step', targetWindowTitle: '' })
      ;(window as any)[GAME_CONTROL_STARTED_KEY] = true
    }

    const result = await softwareExecute({
      action: input.action,
      key: input.key,
      keys: input.keys,
      duration: input.duration,
      button: input.button,
      x: input.x,
      y: input.y,
    })

    if (result?.ok)
      return `操作完成：${input.action} ${input.key ?? input.keys ?? ''}`
    return `操作失败：${result?.error ?? '未知错误'}`
  }
  catch (e: any) {
    return `游戏控制异常：${e?.message || String(e)}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'game_control',
    description: [
      'Directly control the keyboard and mouse to play games.',
      'You can press keys (WASD, space, enter, etc.), click the mouse,',
      'and execute key sequences.',
      '',
      'USAGE:',
      '- press_key: "w" to move, "space" to jump, "e" to interact',
      '- key_sequence: "w,w,w,space" to run then jump',
      '- mouse_click: button 1=left, 2=right, 3=middle',
      '- mouse_move: mouse_move with x,y screen coordinates',
      '- wait: pause in milliseconds',
      '- start/stop: begin or end game control',
      '- hardware: set to true to force Arduino hardware mode, false to force software mode',
      '',
      'Keys: w a s d space enter esc e q f r 1-9 shift ctrl alt up down left right',
      'Mouse: use x,y for absolute screen position (e.g. x:500,y:300 for center)',
      'For games: combine look+move — see screen, decide action, press keys!',
      '',
      'IMPORTANT: After pressing a move key like w/a/s/d, the character keeps moving.',
      'Use short key presses (duration 80ms) for movement taps.',
      'If Arduino hardware is connected, it will be used automatically for better anti-cheat bypass.',
    ].join('\n'),
    execute: executeGameControl,
    parameters: gameControlParams,
  }),
]

export const gameControlTools = async () => Promise.all(tools)
