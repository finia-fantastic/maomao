import type { UiohookKeyboardEvent } from 'uiohook-napi'

import type { GameControlStateMachine } from './GameControlState'

import { uIOhook } from 'uiohook-napi'

const LOG_PREFIX = '[GameControl]'

/**
 * Monitors physical keyboard input via the existing uiohook infrastructure.
 *
 * When physical key presses are detected (i.e. key events that arrive
 * while the system is NOT injecting), the guard triggers a manual override
 * on the state machine, blocking all AI-driven actions until the user
 * explicitly resumes.
 *
 * **Key constraint:** uiohook-napi's `UiohookKeyboardEvent` does NOT expose
 * a `flags` or `LLKHF_INJECTED` field (confirmed by its type definitions).
 * Injected keystrokes via `uIOhook.keyTap()` produce events identical to
 * physical keystrokes. To distinguish them, the `GameActionExecutor` sets
 * `isInjecting = true` before injection; the guard skips events arriving
 * during that window.
 *
 * Mouse events are never treated as override triggers.
 */
export class ManualOverrideGuard {
  private stateMachine: GameControlStateMachine
  private listenerAttached = false

  /**
   * When `true`, the keydown/keyup handler skips all events.
   * Set by `GameActionExecutor` before injection and cleared after.
   */
  isInjecting = false

  /** Keys that are currently physically pressed (keycode → true). */
  private physicallyPressed = new Set<number>()

  constructor(stateMachine: GameControlStateMachine) {
    this.stateMachine = stateMachine
  }

  /**
   * Attach uiohook listeners. Safe to call multiple times — only one
   * listener pair is registered.
   */
  start(): void {
    if (this.listenerAttached)
      return
    this.listenerAttached = true

    uIOhook.on('keydown', this.onKeydown)
    uIOhook.on('keyup', this.onKeyup)

    // Ensure uIOhook is running — it may already be started by the
    // global-shortcut-uiohook driver, and `start()` is idempotent at
    // the native level (returns an error code we ignore).
    try {
      uIOhook.start()
    }
    catch {
      // uIOhook may throw if already started or if the platform hook
      // is unavailable; neither condition should prevent monitoring.
    }

    console.info(`${LOG_PREFIX} ManualOverrideGuard started`)
  }

  /**
   * Detach uiohook listeners.
   */
  stop(): void {
    if (!this.listenerAttached)
      return
    this.listenerAttached = false

    uIOhook.removeListener('keydown', this.onKeydown)
    uIOhook.removeListener('keyup', this.onKeyup)
    this.physicallyPressed.clear()

    console.info(`${LOG_PREFIX} ManualOverrideGuard stopped`)
  }

  /**
   * Release all tracked physical keys (safety net when stopping).
   */
  releaseAll(): void {
    this.physicallyPressed.clear()
  }

  private onKeydown = (event: UiohookKeyboardEvent): void => {
    // Skip events during programmatic injection
    if (this.isInjecting)
      return

    // Only trigger on first press, not auto-repeat
    if (this.physicallyPressed.has(event.keycode))
      return

    this.physicallyPressed.add(event.keycode)

    // Trigger override — physical keyboard input detected
    this.stateMachine.triggerOverride('physical_keyboard_input')
  }

  private onKeyup = (event: UiohookKeyboardEvent): void => {
    if (this.isInjecting)
      return
    this.physicallyPressed.delete(event.keycode)
  }
}
