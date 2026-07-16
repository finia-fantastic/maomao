import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

// UiohookKey codes for common game keys
const KEY_MAP: Record<string, number> = {
  // Movement
  w: 17, a: 30, s: 31, d: 32,
  up: 0xc8, down: 0xd0, left: 0xcb, right: 0xcd,
  // Actions
  space: 57, enter: 28, esc: 1, tab: 15,
  shift: 42, ctrl: 29, alt: 56,
  // Numbers
  '1': 2, '2': 3, '3': 4, '4': 5, '5': 6,
  '6': 7, '7': 8, '8': 9, '9': 10, '0': 11,
  // Letters
  e: 18, q: 16, r: 19, f: 33, z: 44, x: 45, c: 46,
  g: 34, h: 35, i: 23, j: 36, k: 37, l: 38,
  m: 50, n: 49, o: 24, p: 25,
  t: 20, u: 22, v: 47,
  b: 48, y: 21,
}

const gameControlParams = z.object({
  action: z.enum(['press_key', 'key_sequence', 'wait', 'mouse_click', 'start', 'stop']).describe(
    'Action type:\n' +
    '- press_key: press and release a single key\n' +
    '- key_sequence: press multiple keys in order\n' +
    '- wait: pause between actions (milliseconds)\n' +
    '- mouse_click: click left/right/middle mouse\n' +
    '- start: begin game control (target window title optional)\n' +
    '- stop: end game control',
  ),
  key: z.string().describe('For press_key: key name (w/a/s/d/space/enter/esc/e/q/f/1-9 etc.)').optional(),
  keys: z.string().describe('For key_sequence: comma-separated key names (e.g. "w,w,w,space")').optional(),
  duration: z.number().describe('For wait: milliseconds to wait. For press_key: hold duration (default 50ms).').optional(),
  button: z.number().min(1).max(3).describe('For mouse_click: 1=left, 2=right, 3=middle').optional(),
  target_window: z.string().describe('For start: game window title to focus (optional).').optional(),
})

const GAME_CONTROL_STARTED_KEY = '__game_control_started'

/**
 * Game control tool — allows the AI to directly press keyboard keys,
 * click the mouse, and control games in real time via uiohook-napi.
 */
async function executeGameControl(input: {
  action: string
  key?: string
  keys?: string
  duration?: number
  button?: number
  target_window?: string
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
        return '游戏控制已启动。可以开始操作了。'
      }
      return `启动失败：${result?.error ?? '未知'}`
    }

    if (input.action === 'stop') {
      ;(window as any)[GAME_CONTROL_STARTED_KEY] = false
      await ipc.invoke('game-control:stop')
      return '游戏控制已停止。'
    }

    // Auto-start if not started yet
    if (!(window as any)[GAME_CONTROL_STARTED_KEY]) {
      await ipc.invoke('game-control:start', { mode: 'single_step', targetWindowTitle: '' })
      ;(window as any)[GAME_CONTROL_STARTED_KEY] = true
    }

    // Build action plan
    const actions: Array<{ type: string, params: Record<string, unknown> }> = []

    switch (input.action) {
      case 'press_key': {
        const keyName = (input.key ?? 'w').toLowerCase()
        const keycode = KEY_MAP[keyName]
        if (keycode == null) return `未知按键："${input.key}"。可用按键：${Object.keys(KEY_MAP).join(', ')}`
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
          if (keycode == null) return `未知按键："${k}"`
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
    }

    const result = await ipc.invoke('game-control:execute', {
      description: `${input.action} ${input.key ?? input.keys ?? ''}`,
      actions,
    })

    if (result?.ok) return `操作完成：${input.action} ${input.key ?? input.keys ?? ''}`
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
      '- press_key: "w" to move forward, "space" to jump, "e" to interact',
      '- key_sequence: "w,w,w,space" to run forward then jump',
      '- mouse_click: button 1 to left-click',
      '- wait: pause (e.g. 500ms between actions)',
      '- start: begin game control (optional: set game window title)',
      '- stop: end game control',
      '',
      'Available keys: w a s d space enter esc e q f r 1-9 shift ctrl alt up down left right',
      'Use this for: moving characters, interacting in games, navigating menus.',
      '',
      'IMPORTANT: After pressing a move key like w/a/s/d, the character keeps moving.',
      'Use short key presses (duration 80ms) for movement taps.',
    ].join('\n'),
    execute: executeGameControl,
    parameters: gameControlParams,
  }),
]

export const gameControlTools = async () => Promise.all(tools)
