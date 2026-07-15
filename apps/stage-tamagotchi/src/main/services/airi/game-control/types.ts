/**
 * Shared types for the 3D Game Visual Control System.
 *
 * This module is independent from mainv10 (the Python word learning app).
 * All code lives in the AIRI Electron desktop pet project.
 */

/**
 * Modes of the game control state machine.
 *
 * - `disabled`: Game control is inactive. No hooks, no injection.
 * - `single_step`: AI can execute one action at a time (manual trigger each step).
 * - `assisted`: AI can autonomously execute actions (vision→action loop).
 * - `executing`: An action is currently being executed; new actions are blocked.
 * - `manual_override`: Physical keyboard input detected; all AI actions blocked until resume.
 * - `error`: Fatal error; manual intervention required.
 */
export type GameControlMode
  = 'disabled'
    | 'single_step'
    | 'assisted'
    | 'executing'
    | 'manual_override'
    | 'error'

/**
 * Full snapshot of the game control system state.
 */
export interface GameControlState {
  /** Current mode. */
  mode: GameControlMode
  /** Human-readable label for the last executed action, or null. */
  lastAction: string | null
  /** Timestamp of the last action execution. */
  lastActionAt: number | null
  /** Last error message, or null. */
  lastError: string | null
  /** Reason the system entered manual_override or error, or null. */
  stopReason: string | null
  /** Name of the target game window (empty string disables window guard). */
  targetWindowTitle: string
}

/**
 * A single injectable action that the game control system can execute.
 */
export interface GameAction {
  /** Unique action identifier for tracking. */
  id: string
  /** The type of action to perform. */
  type: 'key_press' | 'key_sequence' | 'wait' | 'mouse_click'
  /** Action-specific parameters. */
  params: KeyPressParams | KeySequenceParams | WaitParams | MouseClickParams
}

/** Press and release one key, optionally with modifiers. */
export interface KeyPressParams {
  /** `UiohookKey` value (e.g. `UiohookKey.W`). */
  key: number
  /** Optional modifier keycodes (e.g. `[UiohookKey.Ctrl]`). */
  modifiers?: number[]
  /** How long to hold the key in milliseconds (default 50). */
  durationMs?: number
}

/** Execute a sequence of key presses in order. */
export interface KeySequenceParams {
  keys: KeyPressParams[]
}

/** Pause between actions. */
export interface WaitParams {
  durationMs: number
}

/** Click a mouse button. */
export interface MouseClickParams {
  /** 1 = left, 2 = right, 3 = middle. */
  button: 1 | 2 | 3
}

/**
 * Reason emitted when manual override is triggered.
 */
export type OverrideReason
  = 'physical_keyboard_input'
    | 'target_window_lost'
    | '連續api錯誤'

/**
 * Result of executing a single action.
 */
export interface ActionResult {
  success: boolean
  actionId: string
  error?: string
  durationMs: number
}
