import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/**
 * Reason the system entered manual_override, shared across the IPC boundary.
 * Mirrors the main-process type without importing from the main layer.
 */
export type OverrideReason
  = 'physical_keyboard_input'
    | 'target_window_lost'
    | '連續api錯誤'

/**
 * Generic result payload for game control operations.
 */
export interface GameControlResult {
  ok: boolean
  error?: string
}

/**
 * Snapshot of the game control state returned to the renderer.
 * Mirrors the main-process type but lives in the shared layer.
 */
export interface GameControlStateSnapshot {
  mode: 'disabled' | 'single_step' | 'assisted' | 'executing' | 'manual_override' | 'error'
  lastAction: string | null
  lastActionAt: number | null
  lastError: string | null
  stopReason: OverrideReason | string | null
  targetWindowTitle: string
}

/**
 * An action plan produced by the consciousness model describing one or
 * more injectable keystrokes.
 */
export interface GameActionPlan {
  /** Human-readable description of the action (for logging and UI). */
  description: string
  /** Sequence of raw actions to execute. */
  actions: GameActionPayload[]
}

/**
 * One step in an action plan, serialised for IPC.
 */
export interface GameActionPayload {
  type: 'key_press' | 'key_sequence' | 'wait' | 'mouse_click' | 'mouse_move'
  params: Record<string, unknown>
}

// ── IPC Contracts ────────────────────────────────────────────────

/**
 * Start game control in the given mode.
 * Returns the initial state snapshot.
 */
export const gameControlStart = defineInvokeEventa<
  GameControlResult & { state?: GameControlStateSnapshot },
  { mode: 'single_step' | 'assisted', targetWindowTitle?: string }
>('eventa:invoke:electron:game-control:start')

/**
 * Stop game control and return to disabled mode.
 */
export const gameControlStop = defineInvokeEventa<
  GameControlResult & { state?: GameControlStateSnapshot }
>('eventa:invoke:electron:game-control:stop')

/**
 * Resume from manual_override.
 */
export const gameControlResume = defineInvokeEventa<
  GameControlResult & { state?: GameControlStateSnapshot },
  { mode?: 'single_step' | 'assisted' }
>('eventa:invoke:electron:game-control:resume')

/**
 * Get the current state snapshot.
 */
export const gameControlGetState = defineInvokeEventa<
  GameControlStateSnapshot
>('eventa:invoke:electron:game-control:get-state')

/**
 * Execute a single action (used in single_step mode).
 * The action plan is a named action with description + actions list.
 */
export const gameControlExecuteAction = defineInvokeEventa<
  { ok: boolean, error?: string, results?: Array<{ success: boolean, actionId: string, error?: string }> },
  GameActionPlan
>('eventa:invoke:electron:game-control:execute-action')

/**
 * Set the target game window title for the foreground guard.
 */
export const gameControlSetTargetWindow = defineInvokeEventa<
  GameControlResult,
  { targetWindowTitle: string }
>('eventa:invoke:electron:game-control:set-target-window')

/**
 * Event emitted on the main → renderer channel when the game control
 * state changes (mode transition, override, error, etc.).
 */
export const gameControlStateChanged = defineEventa<GameControlStateSnapshot>(
  'eventa:event:electron:game-control:state-changed',
)
