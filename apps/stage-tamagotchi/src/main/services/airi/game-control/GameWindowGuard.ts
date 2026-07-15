import type { GameControlStateMachine } from './GameControlState'

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

const execFileAsync = promisify(execFile)

const LOG_PREFIX = '[GameControl]'

/**
 * Checks the foreground window to verify the target game is still active.
 *
 * Uses `powershell` to call `GetForegroundWindow` + `GetWindowText` via
 * a compiled `Add-Type` helper. This avoids native dependencies while
 * staying reliable on Windows.
 *
 * When the foreground window does not match the configured target, the
 * guard triggers a manual override with reason `target_window_lost`.
 *
 * Check interval is managed externally (e.g. before each action execution
 * or on a timer from the orchestrator).
 */
export class GameWindowGuard {
  private stateMachine: GameControlStateMachine

  constructor(stateMachine: GameControlStateMachine) {
    this.stateMachine = stateMachine
  }

  /**
   * Returns the title of the current foreground window.
   * Returns `null` on any error (process timeout, PowerShell unavailable, etc.)
   */
  async getForegroundWindowTitle(): Promise<string | null> {
    try {
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FgWin {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$hwnd = [FgWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[FgWin]::GetWindowText($hwnd, $sb, 256)
$sb.ToString()
`
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psScript,
      ], {
        timeout: 5000,
        windowsHide: true,
      })

      return stdout?.trim() || null
    }
    catch (error) {
      console.warn(`${LOG_PREFIX} GetForegroundWindow failed:`, errorMessageFrom(error) ?? 'Unknown error')
      return null
    }
  }

  /**
   * Verify that the target game window is currently in the foreground.
   *
   * @param targetWindowTitle - The window title to match (substring match, case-insensitive).
   *   If empty or the state machine is not active, the check passes.
   * @returns `true` if the target is in the foreground or the guard is disabled.
   */
  async verifyForeground(targetWindowTitle: string): Promise<boolean> {
    if (!targetWindowTitle || !this.stateMachine.isActive) {
      return true
    }

    const actual = await this.getForegroundWindowTitle()
    if (actual === null) {
      // Can't determine foreground window — log and pass through
      // to avoid blocking actions when the system is unavailable
      console.warn(`${LOG_PREFIX} could not determine foreground window; allowing action`)
      return true
    }

    const match = actual.toLowerCase().includes(targetWindowTitle.toLowerCase())
    if (!match) {
      console.info(`${LOG_PREFIX} foreground window mismatch: expected "${targetWindowTitle}", got "${actual}"`)
      this.stateMachine.triggerOverride('target_window_lost')
      return false
    }

    return true
  }
}
