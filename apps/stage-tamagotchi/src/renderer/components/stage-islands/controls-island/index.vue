<script setup lang="ts">
import { defineInvoke } from '@moeru/eventa'
import { useElectronEventaContext, useElectronEventaInvoke, useElectronMouseInElement } from '@proj-airi/electron-vueuse'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'

import { useVisionOrchestratorStore } from '@proj-airi/stage-ui/stores/modules/vision/orchestrator'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useTheme } from '@proj-airi/ui'
import { refDebounced, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'
import ControlsIslandAuthButton from './controls-island-auth-button.vue'
import ControlsIslandFadeOnHover from './controls-island-fade-on-hover.vue'
import ControlsIslandProfilePicker from './controls-island-profile-picker.vue'

import {
  electron,
  electronAppQuit,
  electronOpenChat,
  electronOpenSettings,
  electronOpenVocabApp,
  electronStartDraggingWindow,
  electronWindowSetAlwaysOnTop,
} from '../../../../shared/eventa'

const { isDark, toggleDark } = useTheme()
const { t } = useI18n()

const settingsStore = useSettings()
const context = useElectronEventaContext()
const { alwaysOnTop, controlsIslandIconSize } = storeToRefs(settingsStore)
const openSettings = useElectronEventaInvoke(electronOpenSettings)
const openChat = useElectronEventaInvoke(electronOpenChat)
const isLinux = useElectronEventaInvoke(electron.app.isLinux)
const closeWindow = useElectronEventaInvoke(electronAppQuit)
const setAlwaysOnTop = useElectronEventaInvoke(electronWindowSetAlwaysOnTop)
const openVocabApp = useElectronEventaInvoke(electronOpenVocabApp)

// NOTICE:
// User's personal webpage — a local Vite dev server (React SPA). The button in the
// expanded controls opens it in the system browser: window.open() is intercepted by
// the main window's setWindowOpenHandler (src/main/windows/main/index.ts), which
// forwards the URL to shell.openExternal. Change this URL if the SPA's port changes.
// The SPA uses a dedicated port (5199) so it never collides with AIRI's own 5173 renderer.
const WEBPAGE_URL = 'http://localhost:5199'

function openWebpage() {
  window.open(WEBPAGE_URL, '_blank')
}

const expanded = ref(false)
const islandRef = ref<HTMLElement>()

// Tracks open overlays/dialogs that should prevent auto-collapse (e.g. 'profile-picker')
const blockingOverlays = reactive(new Set<string>())
const isBlocked = computed(() => blockingOverlays.size > 0)

function setOverlay(key: string, active: boolean) {
  if (active) {
    blockingOverlays.add(key)
    return
  }

  blockingOverlays.delete(key)
}

const { isOutside } = useElectronMouseInElement(islandRef)
const isOutsideAfter2seconds = refDebounced(isOutside, 1500)

watch(isOutsideAfter2seconds, (outside) => {
  if (outside && expanded.value && !isBlocked.value) {
    expanded.value = false
  }
})

watch(expanded, (isExpanded) => {
  if (!isExpanded) {
    blockingOverlays.clear()
  }
})

useIntervalFn(() => {
  if (expanded.value && isOutside.value && !isBlocked.value) {
    expanded.value = false
  }
}, 1500)

// Apply alwaysOnTop on mount and when it changes
watch(alwaysOnTop, (val) => {
  setAlwaysOnTop(val)
}, { immediate: true })

function toggleAlwaysOnTop() {
  alwaysOnTop.value = !alwaysOnTop.value
}

// Grouped classes for icon / border / padding and combined style class
const adjustStyleClasses = computed(() => {
  let isLarge: boolean

  // Determine size based on setting
  switch (controlsIslandIconSize.value) {
    case 'large':
      isLarge = true
      break
    case 'small':
      isLarge = false
      break
    case 'auto':
    default:
      // Fixed to large for better visibility in the new layout,
      // can be changed to windowHeight based check if absolutely needed.
      isLarge = true
      break
  }

  const icon = isLarge ? 'size-5' : 'size-3'
  const border = isLarge ? 'border-2' : 'border-0'
  const padding = isLarge ? 'p-2' : 'p-0.5'
  return { icon, border, padding, button: `${border} ${padding}` }
})

/**
 * This is a know issue (or expected behavior maybe) to Electron.
 * We don't use this approach on Linux because it's not working.
 *
 * See `apps/stage-tamagotchi/src/main/windows/main/index.ts` for handler definition
 */
const startDraggingWindow = !isLinux() ? defineInvoke(context.value, electronStartDraggingWindow) : undefined

const visionOrchestrator = useVisionOrchestratorStore()
const characterOrchestrator = useCharacterOrchestratorStore()
const chatSessionStore = useChatSessionStore()

// ---- Screenshot pipeline: Capture → VLM → React -------------------------

async function captureScreen(): Promise<string | null> {
  const result = await window.electron.ipcRenderer.invoke('screen-capture:capture')
  const dataUrl = result?.dataUrl
  if (!dataUrl) {
    console.warn('[Capture] IPC returned no data')
    return null
  }
  console.info('[Capture] got data URL, length:', dataUrl.length)
  return dataUrl
}

async function processCapture(dataUrl: string): Promise<string | null> {
  const vlmResult = await visionOrchestrator.processCapture({
    imageDataUrl: dataUrl,
    workloadId: 'screen:commentary',
    sourceId: 'screenshot-button',
    capturedAt: Date.now(),
    publishContext: false,
  })
  const text = vlmResult.text
  if (!text) {
    console.warn('[Vision] VLM returned empty text')
    return null
  }
  console.info('[Vision] VLM response:', text.slice(0, 120))
  return text
}

async function handleVisionResult(text: string): Promise<void> {
  // 1. Generate character reaction via consciousness model
  // Force Chinese output via system instructions override
  const notifyEvent = {
    type: 'spark:notify',
    source: 'vision:screenshot-button',
    data: {
      id: `screenshot-${Date.now()}`,
      eventId: `screenshot-${Date.now()}`,
      kind: 'ping' as const,
      urgency: 'immediate' as const,
      headline: text,
      note: 'You just saw this on the user\'s screen. React naturally, 1-2 short sentences.',
      destinations: ['character'],
      metadata: { module: 'vision', workload: 'screen:commentary' },
    },
  }
  const reactionText = await characterOrchestrator.handleSparkNotifyWithReaction(
    notifyEvent as any,
    {
      fallbackText: text,
      forceTextResponse: true,
      messageOverride: {
        appendSystemInstructions: [
          'IMPORTANT: You MUST output in Chinese (简体中文) only. No English, no Japanese.',
        ],
      },
    },
  )
  console.info('[Reaction] spark notify done, reaction:', reactionText?.slice(0, 80))

  // 2. Strip internal markup tags and verbose headers before writing to chat
  const stripMarkup = (t: string) => t
    .replace(/<\|ACT\s*\{[^}]+\}\s*\|>/g, '')
    .replace(/<\|DELAY\s*\d+\|>/g, '')
    .replace(/<\|[A-Z_]+(\s*\{[^}]*\})?\s*\|>/g, '')
    // Remove headers that VLM/consciousness model sometimes prepend
    .replace(/^(?:请看你的屏幕|屏幕内容：|您屏幕上的内容：|我看到：|我注意到：)\s*/i, '')
    .trim()

  const sessionId = chatSessionStore.activeSessionId
  const finalText = stripMarkup(reactionText?.trim() || text)
  if (sessionId && finalText) {
    chatSessionStore.appendSessionMessage(sessionId, {
      role: 'assistant' as const,
      content: '',
      slices: [{ type: 'text' as const, text: finalText }],
      tool_results: [],
      createdAt: Date.now(),
      id: `vision-${Date.now()}`,
    })
    console.info('[Reaction] written to chat:', finalText.slice(0, 80))
  }
}

async function takeScreenshot() {
  // Stage 1: Capture
  let dataUrl: string | null = null
  try {
    dataUrl = await captureScreen()
  }
  catch (e) {
    console.error('[Capture] screenshot failed:', e)
    return
  }
  if (!dataUrl)
    return

  // Stage 2: Vision inference
  let visionText: string | null = null
  try {
    visionText = await processCapture(dataUrl)
  }
  catch (e) {
    console.error('[Vision] inference failed:', e)
    return
  }
  if (!visionText)
    return

  // Stage 3: Character reaction
  try {
    await handleVisionResult(visionText)
  }
  catch (e) {
    console.error('[Reaction] spark notify failed:', e)
  }
}

function refreshWindow() {
  window.location.reload()
}

/**
 * Auto-detect if the vocab app is running and show a switch button.
 * Polls via IPC every 3 seconds; the main process checks for the
 * pythonw process with "单词听写" in its window title.
 */
const vocabAppOpen = ref(false)

async function checkVocabRunning() {
  try {
    const result = await window.electron.ipcRenderer.invoke('vocab:is-running')
    vocabAppOpen.value = !!result?.running
  }
  catch {
    vocabAppOpen.value = false
  }
}

async function openVocabProgram() {
  // If already running, send show command via socket. Otherwise launch.
  if (vocabAppOpen.value) {
    await window.electron.ipcRenderer.invoke('vocab:show')
  }
  else {
    await openVocabApp().catch(() => {})
  }
  setTimeout(checkVocabRunning, 800)
}

// Poll for vocab app presence
useIntervalFn(checkVocabRunning, 5000)
</script>

<template>
  <div ref="islandRef" fixed bottom-2 right-2>
    <div flex flex-col items-end gap-1>
      <!-- iOS Style Drawer Panel -->
      <Transition
        enter-active-class="transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)"
        leave-active-class="transition-all duration-400 cubic-bezier(0.32, 0.72, 0, 1)"
        enter-from-class="opacity-0 translate-y-8 scale-90 blur-sm"
        leave-to-class="opacity-0 translate-y-8 scale-90 blur-sm"
      >
        <div v-if="expanded" border="1 neutral-200 dark:neutral-800" mb-2 flex flex-col gap-1 rounded-2xl p-2 backdrop-blur-xl class="bg-neutral-100/80 shadow-2xl shadow-black/20 dark:bg-neutral-900/80">
          <ControlsIslandAuthButton
            :button-style="adjustStyleClasses.button"
            :icon-class="adjustStyleClasses.icon"
            @open-profile-picker="setOverlay('profile-picker', true)"
          />

          <div grid grid-cols-3 gap-2>
            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" @click="openSettings({ route: '/settings' })">
                <div i-solar:settings-minimalistic-outline :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-settings') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip disable-hoverable-content>
              <ControlsIslandProfilePicker placement="up" :open="blockingOverlays.has('profile-picker')" @update:open="setOverlay('profile-picker', $event)">
                <template #default="{ toggle }">
                  <ControlButton :button-style="adjustStyleClasses.button" @click="toggle">
                    <div i-solar:emoji-funny-square-broken :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
                  </ControlButton>
                </template>
              </ControlsIslandProfilePicker>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.switch-profile') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" @click="openWebpage">
                <div i-solar:global-linear :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
              </ControlButton>
              <template #tooltip>
                打开网页
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" @click="refreshWindow">
                <div i-solar:refresh-linear :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.refresh') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" @click="openVocabProgram">
                <div i-solar:notebook-linear :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
              </ControlButton>
              <template #tooltip>
                背单词
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" @click="toggleDark()">
                <Transition name="fade" mode="out-in">
                  <div v-if="isDark" i-solar:moon-outline :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
                  <div v-else i-solar:sun-2-outline :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
                </Transition>
              </ControlButton>
              <template #tooltip>
                {{ isDark ? t('tamagotchi.stage.controls-island.switch-to-light-mode') : t('tamagotchi.stage.controls-island.switch-to-dark-mode') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" @click="toggleAlwaysOnTop()">
                <div v-if="alwaysOnTop" i-solar:pin-bold :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
                <div v-else i-solar:pin-linear :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300 opacity-50" />
              </ControlButton>
              <template #tooltip>
                {{ alwaysOnTop ? t('tamagotchi.stage.controls-island.unpin-from-top') : t('tamagotchi.stage.controls-island.pin-on-top') }}
              </template>
            </ControlButtonTooltip>

            <ControlsIslandFadeOnHover :icon-class="adjustStyleClasses.icon" :button-style="adjustStyleClasses.button" />

            <ControlButtonTooltip disable-hoverable-content>
              <ControlButton :button-style="adjustStyleClasses.button" hover:bg-red-500 hover:text-white @click="closeWindow()">
                <div i-solar:close-circle-outline :class="adjustStyleClasses.icon" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.close') }}
              </template>
            </ControlButtonTooltip>
          </div>
        </div>
      </Transition>

      <!-- Main Controls -->
      <div flex flex-col gap-1>
        <ControlButtonTooltip side="left">
          <ControlButton :button-style="adjustStyleClasses.button" @click="expanded = !expanded">
            <div
              :class="[adjustStyleClasses.icon, expanded ? 'rotate-180' : 'rotate-0']"
              i-solar:alt-arrow-up-line-duotone scale-110 transition-all duration-300
              text="neutral-800 dark:neutral-300"
            />
          </ControlButton>
          <template #tooltip>
            {{ expanded ? t('tamagotchi.stage.controls-island.collapse') : t('tamagotchi.stage.controls-island.expand') }}
          </template>
        </ControlButtonTooltip>

        <ControlButtonTooltip side="left">
          <ControlButton :button-style="adjustStyleClasses.button" @click="openChat">
            <div i-solar:chat-line-line-duotone :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
          </ControlButton>
          <template #tooltip>
            {{ t('tamagotchi.stage.controls-island.open-chat') }}
          </template>
        </ControlButtonTooltip>

        <ControlButtonTooltip v-if="vocabAppOpen" side="left">
          <ControlButton :button-style="adjustStyleClasses.button" @click="openVocabProgram">
            <div i-solar:notebook-linear :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
          </ControlButton>
          <template #tooltip>
            切换到单词本
          </template>
        </ControlButtonTooltip>

        <ControlButtonTooltip side="left">
          <ControlButton :button-style="adjustStyleClasses.button" @click="takeScreenshot">
            <div i-solar:camera-linear :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
          </ControlButton>
          <template #tooltip>
            截图看看
          </template>
        </ControlButtonTooltip>

        <ControlButtonTooltip side="left">
          <ControlButton :button-style="adjustStyleClasses.button" cursor-move :class="{ 'drag-region': isLinux }" @mousedown="startDraggingWindow?.()">
            <div i-ph:arrows-out-cardinal :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
          </ControlButton>
          <template #tooltip>
            {{ t('tamagotchi.stage.controls-island.drag-to-move-window') }}
          </template>
        </ControlButtonTooltip>
      </div>
    </div>
  </div>
</template>
