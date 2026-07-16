import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { GameActionPlan } from '../../../../shared/eventa/game-control'
import type { GameAction } from './types'

import { defineInvokeHandler } from '@moeru/eventa'
import { ipcMain } from 'electron'

import {
  gameControlExecuteAction,
  gameControlGetState,
  gameControlResume,
  gameControlSetTargetWindow,
  gameControlStart,
  gameControlStateChanged,
  gameControlStop,
} from '../../../../shared/eventa/game-control'
import { GameActionExecutor } from './GameActionExecutor'
import { GameControlStateMachine } from './GameControlState'
import { GameWindowGuard } from './GameWindowGuard'
import { ManualOverrideGuard } from './ManualOverrideGuard'

const LOG_PREFIX = '[GameControl]'

/**
 * Main entry point for the 3D Game Visual Control System.
 *
 * Wires together the state machine, manual override guard, action executor,
 * window guard, and IPC handlers. Designed to be registered via `injeca`
 * in the Electron main process DI container.
 */
export interface GameControlServiceOptions {
  context: ReturnType<typeof createContext>['context']
}

export interface GameControlService {
  /** Start game control in the given mode. */
  start: (mode: 'single_step' | 'assisted', targetWindowTitle?: string) => void
  /** Stop game control. */
  stop: () => void
  /** Resume from manual_override. */
  resume: (mode?: 'single_step' | 'assisted') => void
  /** Execute an action plan (from vision pipeline). */
  executeActionPlan: (plan: GameActionPlan) => Promise<{ ok: boolean, error?: string, results?: Array<{ success: boolean, actionId: string, error?: string }> }>
  /** Get current state snapshot. */
  getState: () => ReturnType<GameControlStateMachine['getState']>
  /** Access to the state machine for external observers. */
  stateMachine: GameControlStateMachine
}

export function setupGameControlService(options: GameControlServiceOptions): GameControlService {
  const { context } = options

  // ── Core components ────────────────────────────────────────────
  const stateMachine = new GameControlStateMachine()
  const overrideGuard = new ManualOverrideGuard(stateMachine)
  const actionExecutor = new GameActionExecutor(overrideGuard)
  const windowGuard = new GameWindowGuard(stateMachine)

  // ── State change → IPC broadcast ────────────────────────────────
  stateMachine.onChange = (snapshot) => {
    try {
      // NOTICE: context.emit() uses the Eventa wire to deliver the payload
      // to any renderer that has set up a listener for this event.
      context.emit(gameControlStateChanged, snapshot as any)
    }
    catch {
      // Gracefully handle edge cases during app teardown
    }
  }

  // ── IPC Handlers ────────────────────────────────────────────────

  defineInvokeHandler(context, gameControlStart, async (payload) => {
    console.info(`${LOG_PREFIX} IPC start:`, payload)

    if (stateMachine.mode !== 'disabled') {
      return { ok: false, error: `Already active in mode ${stateMachine.mode}` }
    }

    overrideGuard.start()
    stateMachine.start(payload.mode, payload.targetWindowTitle ?? '')

    return { ok: true, state: stateMachine.getState() }
  })

  defineInvokeHandler(context, gameControlStop, async () => {
    console.info(`${LOG_PREFIX} IPC stop`)

    actionExecutor.releaseAll()
    overrideGuard.releaseAll()
    overrideGuard.stop()
    stateMachine.stop()

    return { ok: true, state: stateMachine.getState() }
  })

  defineInvokeHandler(context, gameControlResume, async (payload) => {
    if (stateMachine.mode !== 'manual_override') {
      return { ok: false, error: `Cannot resume from mode ${stateMachine.mode}` }
    }

    stateMachine.resume(payload?.mode)
    return { ok: true, state: stateMachine.getState() }
  })

  defineInvokeHandler(context, gameControlGetState, async () => {
    return stateMachine.getState()
  })

  defineInvokeHandler(context, gameControlSetTargetWindow, async (payload) => {
    stateMachine.setTargetWindowTitle(payload.targetWindowTitle)
    return { ok: true }
  })

  defineInvokeHandler(context, gameControlExecuteAction, async (plan) => {
    if (stateMachine.isBlocked) {
      return {
        ok: false,
        error: `Cannot execute action: system is ${stateMachine.mode}. Reason: ${stateMachine.getState().stopReason ?? 'unknown'}`,
      }
    }

    if (!stateMachine.isActive) {
      return { ok: false, error: `Cannot execute action: system is ${stateMachine.mode}. Start game control first.` }
    }

    const windowOk = await windowGuard.verifyForeground(stateMachine.getState().targetWindowTitle)
    if (!windowOk) {
      return { ok: false, error: 'Target window lost focus' }
    }

    const actions = planToActions(plan)
    stateMachine.beginAction(plan.description)

    const results: Array<{ success: boolean, actionId: string, error?: string }> = []
    for (const action of actions) {
      const result = await actionExecutor.execute(action)
      results.push({
        success: result.success,
        actionId: result.actionId,
        error: result.error,
      })
      if (!result.success) {
        break
      }
    }

    stateMachine.completeAction()

    const allOk = results.every(r => r.success)
    return {
      ok: allOk,
      error: allOk ? undefined : results.find(r => !r.success)?.error,
      results,
    }
  })

  // ── Simple IPC handlers for the LLM tool ────────────────────────
  // The eventa handlers above use the eventa context; these simple
  // ipcMain.handle calls let the renderer tool call directly without
  // needing the eventa adapter.

  ipcMain.handle('game-control:start', async (_e, p: { mode?: string, targetWindowTitle?: string }) => {
    overrideGuard.start()
    stateMachine.start((p?.mode as 'single_step' | 'assisted') || 'single_step', p?.targetWindowTitle ?? '')
    return { ok: true }
  })

  ipcMain.handle('game-control:stop', async () => {
    actionExecutor.releaseAll()
    overrideGuard.releaseAll()
    overrideGuard.stop()
    stateMachine.stop()
    return { ok: true }
  })

  ipcMain.handle('game-control:execute', async (_e, plan: GameActionPlan) => {
    if (stateMachine.isBlocked || !stateMachine.isActive) {
      stateMachine.start('single_step', '')
    }
    const actions = planToActions(plan)
    stateMachine.beginAction(plan.description)
    const results: Array<{ success: boolean, actionId: string, error?: string }> = []
    for (const action of actions) {
      const result = await actionExecutor.execute(action)
      results.push({ success: result.success, actionId: result.actionId, error: result.error })
      if (!result.success) break
    }
    stateMachine.completeAction()
    return { ok: results.every(r => r.success), error: results.find(r => !r.success)?.error, results }
  })

  // ── Public API ──────────────────────────────────────────────────

  return {
    start: (mode, targetWindowTitle) => {
      overrideGuard.start()
      stateMachine.start(mode, targetWindowTitle ?? '')
    },
    stop: () => {
      actionExecutor.releaseAll()
      overrideGuard.releaseAll()
      overrideGuard.stop()
      stateMachine.stop()
    },
    resume: (mode) => {
      stateMachine.resume(mode)
    },
    executeActionPlan: async (plan) => {
      if (stateMachine.isBlocked) {
        return { ok: false, error: `System is ${stateMachine.mode}` }
      }
      if (!stateMachine.isActive) {
        return { ok: false, error: 'Game control is not active' }
      }

      const windowOk = await windowGuard.verifyForeground(stateMachine.getState().targetWindowTitle)
      if (!windowOk) {
        return { ok: false, error: 'Target window lost focus' }
      }

      const actions = planToActions(plan)
      stateMachine.beginAction(plan.description)

      const results: Array<{ success: boolean, actionId: string, error?: string }> = []
      for (const action of actions) {
        const result = await actionExecutor.execute(action)
        results.push({
          success: result.success,
          actionId: result.actionId,
          error: result.error,
        })
        if (!result.success) {
          break
        }
      }

      stateMachine.completeAction()

      const allOk = results.every(r => r.success)
      return { ok: allOk, error: allOk ? undefined : results.find(r => !r.success)?.error, results }
    },
    getState: () => stateMachine.getState(),
    stateMachine,
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Convert an IPC-serialised action plan into internal `GameAction` objects.
 */
function planToActions(plan: GameActionPlan): GameAction[] {
  return plan.actions.map((a, i) => ({
    id: `${plan.description}-${i}`,
    type: a.type as GameAction['type'],
    params: a.params as unknown as GameAction['params'],
  }))
}
