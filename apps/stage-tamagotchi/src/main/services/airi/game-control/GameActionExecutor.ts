import type { ManualOverrideGuard } from './ManualOverrideGuard'
import type { ActionResult, GameAction, KeyPressParams, KeySequenceParams, MouseClickParams, MouseMoveParams, WaitParams } from './types'

import { errorMessageFrom } from '@moeru/std'
import { execSync } from 'node:child_process'
import { uIOhook } from 'uiohook-napi'
import { setAiInjecting } from '../game-learning'

const LOG_PREFIX = '[GameControl]'

/**
 * Executes game actions by injecting keystrokes and mouse clicks via
 * the uiohook-native SendInput binding.
 *
 * Injected keystrokes use `uIOhook.keyToggle()` (press/release) for
 * precise hold durations and `uIOhook.keyTap()` for quick presses.
 * The associated {@link ManualOverrideGuard} is notified via
 * `isInjecting` before and after each injection so that injected
 * events are not mistaken for physical keyboard input.
 *
 * **Safety:** Every action path has a `finally` block that ensures
 * all pressed keys are released, preventing stuck keys.
 */
export class GameActionExecutor {
  private guard: ManualOverrideGuard
  private pressedKeys = new Set<number>()

  constructor(guard: ManualOverrideGuard) {
    this.guard = guard
  }

  /**
   * Execute a single game action and return the result.
   * Throws if the guard is in injecting state (should not happen in practice).
   */
  async execute(action: GameAction): Promise<ActionResult> {
    const start = Date.now()
    // Mark that AI is injecting keys — the teaching recorder ignores these
    setAiInjecting(true)
    try {
      switch (action.type) {
        case 'key_press':
          await this.executeKeyPress(action.params as KeyPressParams)
          break
        case 'key_sequence':
          await this.executeKeySequence(action.params as KeySequenceParams)
          break
        case 'wait':
          await this.executeWait(action.params as WaitParams)
          break
        case 'mouse_click':
          await this.executeMouseClick(action.params as MouseClickParams)
          break
        case 'mouse_move':
          await this.executeMouseMove(action.params as MouseMoveParams)
          break
        default:
          return {
            success: false,
            actionId: action.id,
            error: `Unknown action type: ${(action as GameAction).type}`,
            durationMs: Date.now() - start,
          }
      }
      return {
        success: true,
        actionId: action.id,
        durationMs: Date.now() - start,
      }
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'Unknown error'
      console.error(`${LOG_PREFIX} action failed: ${action.id}`, message)
      return {
        success: false,
        actionId: action.id,
        error: message,
        durationMs: Date.now() - start,
      }
    }
    finally {
      // Safety: release any keys that might still be held
      setAiInjecting(false)
      this.releaseAll()
    }
  }

  // ── Individual action handlers ─────────────────────────────────

  /**
   * Inject a key via Win32 keybd_event API using PowerShell P/Invoke.
   * keybd_event is a lower-level API than SendInput and may bypass
   * some game anti-cheat systems.
   */
  private async injectViaSendKeys(key: string, durationMs: number): Promise<void> {
    // Virtual key codes for common game keys
    const vkMap: Record<string, number> = {
      w: 0x57, a: 0x41, s: 0x53, d: 0x44,
      space: 0x20, enter: 0x0D, esc: 0x1B,
      e: 0x45, q: 0x51, f: 0x46, r: 0x52,
      '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34, '5': 0x35,
      shift: 0x10, ctrl: 0x11, alt: 0x12, tab: 0x09,
      up: 0x26, down: 0x28, left: 0x25, right: 0x27,
      m: 0x4D,
    }
    const vk = vkMap[key.toLowerCase()]
    if (vk == null) throw new Error(`Unknown key: ${key}`)

    const holdMs = Math.max(durationMs, 30)

    // keybd_event signature: (bVk, bScan, dwFlags, dwExtraInfo)
    // KEYEVENTF_KEYDOWN = 0x0000, KEYEVENTF_KEYUP = 0x0002
    const ps = `
Add-Type -Name Win32 -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
[Native.Win32]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds ${holdMs}
[Native.Win32]::keybd_event(${vk}, 0, 2, [UIntPtr]::Zero)
`
    execSync(`powershell -NoProfile -Command "${ps}"`, { timeout: 5000 })
  }

  private async executeKeyPress(params: KeyPressParams): Promise<void> {
    const duration = params.durationMs ?? 50
    const keyName = this.keycodeToName(params.key)

    // Try PowerShell SendKeys first (bypasses some anti-cheat)
    try {
      this.guard.isInjecting = true
      await this.injectViaSendKeys(keyName, duration)
      return
    }
    catch {
      // Fall back to uiohook if PowerShell fails
    }
    finally {
      this.guard.isInjecting = false
    }

    // Fallback: original uiohook method
    // Hold modifiers
    if (params.modifiers && params.modifiers.length > 0) {
      for (const mod of params.modifiers) {
        this.pressKey(mod)
      }
    }

    // Press + hold the main key
    this.pressKey(params.key)
    await this.sleep(duration)

    // Release main key
    this.releaseKey(params.key)

    // Release modifiers
    if (params.modifiers && params.modifiers.length > 0) {
      for (const mod of params.modifiers.reverse()) {
        this.releaseKey(mod)
      }
    }
  }

  private async executeKeySequence(params: KeySequenceParams): Promise<void> {
    for (const step of params.keys) {
      await this.executeKeyPress(step)
      // Brief inter-key gap
      await this.sleep(30)
    }
  }

  private async executeWait(params: WaitParams): Promise<void> {
    await this.sleep(params.durationMs)
  }

  private async executeMouseMove(params: MouseMoveParams): Promise<void> {
    this.guard.isInjecting = true
    try {
      // Use PowerShell + .NET to move the cursor on Windows.
      // uiohook-napi doesn't expose a mouse move sending API.
      const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${params.x},${params.y})`
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { timeout: 3000 })
    }
    finally {
      this.guard.isInjecting = false
    }
  }

  private async executeMouseClick(params: MouseClickParams): Promise<void> {
    // uiohook mouse buttons: 1=left, 2=right, 3=middle
    // Use keyToggle-like approach — uiohook doesn't expose mouseToggle,
    // but keyToggle with special keycodes can be mapped.
    //
    // For mouse clicks we use the UiohookKey mouse button codes.
    // NOTICE: uiohook-napi does not expose mouse button constants
    // directly in UiohookKey. We use raw values:
    //   0x01 = mouse left (LBUTTON)
    //   0x02 = mouse right (RBUTTON)
    //   0x04 = mouse middle (MBUTTON)
    // These are the libuiohook virtual button codes used internally.
    const btnMap: Record<number, number> = {
      1: 0x01, // left
      2: 0x02, // right
      3: 0x04, // middle
    }
    const btn = btnMap[params.button]
    if (btn === undefined) {
      throw new Error(`Invalid mouse button: ${params.button}`)
    }

    this.guard.isInjecting = true
    try {
      uIOhook.keyToggle(btn, 'down')
      await this.sleep(50)
      uIOhook.keyToggle(btn, 'up')
    }
    finally {
      this.guard.isInjecting = false
    }
  }

  // ── Low-level key helpers ──────────────────────────────────────

  private pressKey(keycode: number): void {
    this.guard.isInjecting = true
    try {
      uIOhook.keyToggle(keycode, 'down')
      this.pressedKeys.add(keycode)
    }
    finally {
      this.guard.isInjecting = false
    }
  }

  private releaseKey(keycode: number): void {
    this.guard.isInjecting = true
    try {
      uIOhook.keyToggle(keycode, 'up')
      this.pressedKeys.delete(keycode)
    }
    finally {
      this.guard.isInjecting = false
    }
  }

  /**
   * Release ALL currently held keys. Called in `finally` blocks
   * and during emergency cleanup.
   */
  releaseAll(): void {
    if (this.pressedKeys.size === 0)
      return
    this.guard.isInjecting = true
    try {
      for (const keycode of this.pressedKeys) {
        try {
          uIOhook.keyToggle(keycode, 'up')
        }
        catch {
          // Ignore per-key release errors; continue releasing others
        }
      }
      this.pressedKeys.clear()
      console.info(`${LOG_PREFIX} released all held keys`)
    }
    finally {
      this.guard.isInjecting = false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private keycodeToName(code: number): string {
    const map: Record<number, string> = {
      17: 'w', 30: 'a', 31: 's', 32: 'd',
      57: 'space', 28: 'enter', 1: 'esc',
      18: 'e', 16: 'q', 33: 'f', 19: 'r',
      2: '1', 3: '2', 4: '3', 5: '4', 6: '5',
      50: 'm',
    }
    return map[code] ?? `key_${code}`
  }
}
