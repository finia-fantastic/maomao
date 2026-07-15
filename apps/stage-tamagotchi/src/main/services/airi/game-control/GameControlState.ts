import type { GameControlMode, GameControlState, OverrideReason } from './types'

const LOG_PREFIX = '[GameControl]'

/**
 * State machine for the 3D Game Visual Control System.
 *
 * Manages transitions between {@link GameControlMode} states and
 * broadcasts changes via a callback. Designed for the Electron main
 * process — uses plain objects, not Vue refs.
 *
 * State diagram:
 * ```
 * disabled ──start──→ single_step / assisted
 * single_step / assisted ──execute──→ executing
 * executing ──complete──→ single_step / assisted
 * any ──override──→ manual_override
 * manual_override ──resume──→ single_step / assisted
 * any ──error──→ error
 * any ──stop──→ disabled
 * ```
 */
export class GameControlStateMachine {
  private _state: GameControlState = {
    mode: 'disabled',
    lastAction: null,
    lastActionAt: null,
    lastError: null,
    stopReason: null,
    targetWindowTitle: '',
  }

  private previousMode: GameControlMode = 'disabled'

  /** Called whenever the state changes, with the new snapshot. */
  onChange: ((state: GameControlState) => void) | null = null

  /** Get a snapshot of the current state. */
  getState(): GameControlState {
    return { ...this._state }
  }

  get mode(): GameControlMode {
    return this._state.mode
  }

  get isActive(): boolean {
    const m = this._state.mode
    return m === 'single_step' || m === 'assisted' || m === 'executing'
  }

  get isBlocked(): boolean {
    return this._state.mode === 'manual_override' || this._state.mode === 'error'
  }

  private setState(partial: Partial<GameControlState>): void {
    this._state = { ...this._state, ...partial }
    this.onChange?.({ ...this._state })
  }

  private transition(mode: GameControlMode, extra?: Partial<GameControlState>): void {
    this.previousMode = this._state.mode
    const update: Partial<GameControlState> = { mode, ...extra }
    this._state = { ...this._state, ...update }
    console.info(`${LOG_PREFIX} state: ${this.previousMode} → ${mode}`, extra ?? '')
    this.onChange?.({ ...this._state })
  }

  // ── Transition methods ─────────────────────────────────────────

  /** Activate game control in the given mode with an optional target window title. */
  start(mode: 'single_step' | 'assisted', targetWindowTitle: string = ''): void {
    if (this._state.mode !== 'disabled') {
      console.warn(`${LOG_PREFIX} start() ignored: already in mode ${this._state.mode}`)
      return
    }
    this.transition(mode, { targetWindowTitle, lastError: null, stopReason: null })
  }

  /** Mark the start of action execution. */
  beginAction(actionLabel: string): void {
    if (this._state.mode !== 'single_step' && this._state.mode !== 'assisted') {
      console.warn(`${LOG_PREFIX} beginAction() ignored: mode is ${this._state.mode}`)
      return
    }
    this.transition('executing', {
      lastAction: actionLabel,
      lastActionAt: Date.now(),
      lastError: null,
    })
  }

  /** Mark action execution as complete, returning to the previous operational mode. */
  completeAction(): void {
    if (this._state.mode !== 'executing') {
      console.warn(`${LOG_PREFIX} completeAction() ignored: mode is ${this._state.mode}`)
      return
    }
    const returnMode = this.previousMode === 'executing' ? 'single_step' : this.previousMode
    this.transition(returnMode === 'disabled' ? 'single_step' : returnMode as 'single_step' | 'assisted')
  }

  /** Trigger manual override — blocks all AI actions until resume(). */
  triggerOverride(reason: OverrideReason): void {
    if (this._state.mode === 'manual_override' || this._state.mode === 'disabled')
      return
    console.info(`${LOG_PREFIX} manual override: ${reason}`)
    this.transition('manual_override', { stopReason: reason })
  }

  /** Resume from manual_override, optionally specifying the target mode. */
  resume(mode?: 'single_step' | 'assisted'): void {
    if (this._state.mode !== 'manual_override') {
      console.warn(`${LOG_PREFIX} resume() ignored: mode is ${this._state.mode}`)
      return
    }
    const target = mode ?? (this.previousMode === 'assisted' ? 'assisted' : 'single_step')
    this.transition(target, { stopReason: null, lastError: null })
  }

  /** Enter error state. */
  enterError(error: string): void {
    console.error(`${LOG_PREFIX} error: ${error}`)
    this.transition('error', { lastError: error, stopReason: error })
  }

  /** Stop game control and return to disabled. */
  stop(): void {
    if (this._state.mode === 'disabled')
      return
    this.transition('disabled')
  }

  /** Update the target window title without changing mode. */
  setTargetWindowTitle(title: string): void {
    this.setState({ targetWindowTitle: title })
  }

  /** Reset the state machine to initial values. */
  reset(): void {
    this._state = {
      mode: 'disabled',
      lastAction: null,
      lastActionAt: null,
      lastError: null,
      stopReason: null,
      targetWindowTitle: '',
    }
    this.previousMode = 'disabled'
    this.onChange?.({ ...this._state })
  }
}
