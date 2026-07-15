<script setup lang="ts">
import type { GameControlStateSnapshot } from '../../shared/eventa/game-control'

import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button } from '@proj-airi/ui'
import { onBeforeUnmount, ref } from 'vue'

import {
  gameControlExecuteAction,
  gameControlGetState,
  gameControlResume,
  gameControlStart,
  gameControlStateChanged,
  gameControlStop,
} from '../../shared/eventa/game-control'

const rawContext = useElectronEventaContext()
const context = rawContext.value

const state = ref<GameControlStateSnapshot>({
  mode: 'disabled',
  lastAction: null,
  lastActionAt: null,
  lastError: null,
  stopReason: null,
  targetWindowTitle: '',
})

const lastActionResult = ref<string>('')
const targetWindowInput = ref('')
const actionTextInput = ref('')

const startGameControl = useElectronEventaInvoke(gameControlStart)
const stopGameControl = useElectronEventaInvoke(gameControlStop)
const resumeGameControl = useElectronEventaInvoke(gameControlResume)
const getState = useElectronEventaInvoke(gameControlGetState)
const executeAction = useElectronEventaInvoke(gameControlExecuteAction)

// ── Load initial state ─────────────────────────────────────────

async function refreshState(): Promise<void> {
  try {
    const s = await getState()
    if (s) {
      state.value = s
    }
  }
  catch (error) {
    console.error('[GameControlPanel] failed to get state:', error)
  }
}

void refreshState()

// ── Listen for push events ─────────────────────────────────────

const disposeListener = context
  ? context.on(gameControlStateChanged as any, (event: unknown) => {
      state.value = event as GameControlStateSnapshot
    })
  : undefined

onBeforeUnmount(() => {
  disposeListener?.()
})

// ── Actions ────────────────────────────────────────────────────

async function handleStart(mode: 'single_step' | 'assisted'): Promise<void> {
  try {
    const result = await startGameControl({ mode, targetWindowTitle: targetWindowInput.value || undefined })
    if (result.ok && result.state) {
      state.value = result.state
    }
    else {
      lastActionResult.value = `Failed: ${result.error ?? 'unknown error'}`
    }
  }
  catch (error) {
    lastActionResult.value = `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleStop(): Promise<void> {
  try {
    const result = await stopGameControl()
    if (result.ok && result.state) {
      state.value = result.state
    }
  }
  catch (error) {
    lastActionResult.value = `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleResume(): Promise<void> {
  try {
    const result = await resumeGameControl({ mode: 'single_step' })
    if (result.ok && result.state) {
      state.value = result.state
    }
  }
  catch (error) {
    lastActionResult.value = `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function handleExecuteNext(): Promise<void> {
  try {
    const plan = {
      description: actionTextInput.value || 'manual-action',
      actions: [
        { type: 'key_press' as const, params: { key: 17 } }, // W key by default
      ],
    }
    const result = await executeAction(plan)
    lastActionResult.value = result.ok
      ? `Action completed successfully`
      : `Action failed: ${result.error ?? 'unknown'}`
  }
  catch (error) {
    lastActionResult.value = `Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

// ── Mode display helpers ──────────────────────────────────────

const modeLabel: Record<string, string> = {
  disabled: 'Disabled',
  single_step: 'Single Step',
  assisted: 'Assisted',
  executing: 'Executing...',
  manual_override: 'Manual Override',
  error: 'Error',
}

const modeColor: Record<string, string> = {
  disabled: 'text-neutral-400',
  single_step: 'text-green-500',
  assisted: 'text-blue-500',
  executing: 'text-yellow-500',
  manual_override: 'text-red-500',
  error: 'text-red-600',
}

function isActiveMode(m: string): boolean {
  return m === 'single_step' || m === 'assisted'
}
</script>

<template>
  <div :class="['rounded-xl', 'bg-neutral-100', 'p-4', 'dark:bg-[rgba(0,0,0,0.3)]']">
    <!-- Header -->
    <div :class="['text-sm', 'uppercase', 'tracking-wide', 'mb-3', 'text-neutral-400']">
      3D Game Visual Control System
    </div>

    <!-- Status -->
    <div :class="['mb-4', 'flex', 'items-center', 'gap-3']">
      <div :class="['text-lg', 'font-semibold', modeColor[state.mode] || '']">
        {{ modeLabel[state.mode] || state.mode }}
      </div>
      <div v-if="state.mode === 'manual_override' && state.stopReason" :class="['text-sm', 'text-red-400']">
        ({{ state.stopReason }})
      </div>
    </div>

    <!-- Last action -->
    <div v-if="state.lastAction" :class="['mb-3', 'text-sm']">
      <span :class="['text-neutral-400']">Last action: </span>
      <span :class="['text-neutral-600', 'dark:text-neutral-300']">{{ state.lastAction }}</span>
      <span v-if="state.lastActionAt" :class="['ml-2', 'text-xs', 'text-neutral-400']">
        {{ new Date(state.lastActionAt).toLocaleTimeString() }}
      </span>
    </div>

    <!-- Last error -->
    <div v-if="state.lastError" :class="['mb-3', 'text-sm', 'text-amber-500']">
      Error: {{ state.lastError }}
    </div>

    <!-- Action result -->
    <div v-if="lastActionResult" :class="['mb-3', 'text-sm', 'text-neutral-400']">
      {{ lastActionResult }}
    </div>

    <!-- Controls -->
    <div :class="['flex', 'flex-col', 'gap-3']">
      <!-- Target window input -->
      <div :class="['flex', 'items-center', 'gap-2']">
        <label :class="['text-xs', 'text-neutral-400']" for="game-control-target-window">Target window:</label>
        <input
          id="game-control-target-window"
          v-model="targetWindowInput"
          type="text"
          :class="[
            'flex-1', 'rounded-lg', 'border', 'border-neutral-200', 'bg-white',
            'px-2', 'py-1', 'text-sm',
            'dark:border-neutral-800', 'dark:bg-neutral-900',
          ]"
          placeholder="e.g. Elden Ring"
        >
      </div>

      <!-- Mode buttons -->
      <div :class="['flex', 'flex-wrap', 'gap-2']">
        <Button
          label="Enable Single Step"
          size="sm"
          :disabled="state.mode !== 'disabled'"
          @click="handleStart('single_step')"
        />
        <Button
          label="Enable Assisted"
          size="sm"
          :disabled="state.mode !== 'disabled'"
          @click="handleStart('assisted')"
        />
        <Button
          label="Disable"
          size="sm"
          icon="i-solar:stop-line-duotone"
          :disabled="state.mode === 'disabled'"
          @click="handleStop()"
        />
        <Button
          label="Resume"
          size="sm"
          icon="i-solar:play-line-duotone"
          :disabled="state.mode !== 'manual_override'"
          @click="handleResume()"
        />
      </div>

      <!-- Single-step action -->
      <div v-if="isActiveMode(state.mode)" :class="['flex', 'items-center', 'gap-2']">
        <input
          v-model="actionTextInput"
          type="text"
          :class="[
            'flex-1', 'rounded-lg', 'border', 'border-neutral-200', 'bg-white',
            'px-2', 'py-1', 'text-sm',
            'dark:border-neutral-800', 'dark:bg-neutral-900',
          ]"
          placeholder="Action description (optional)"
        >
        <Button
          label="Execute Next"
          size="sm"
          icon="i-solar:play-line-duotone"
          :disabled="state.mode !== 'single_step' && state.mode !== 'assisted'"
          @click="handleExecuteNext()"
        />
      </div>
    </div>
  </div>
</template>
