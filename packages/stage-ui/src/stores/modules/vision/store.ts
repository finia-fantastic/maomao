import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useProvidersStore } from '../../providers'
import { useVisionProcessingStore } from './processing-store'

/** High-frequency (gaming) vs energy-saving (work) screen-watch preset. */
export type VisionMode = 'active' | 'eco'

export interface VisionModePreset {
  /** Milliseconds between frame captures. */
  captureIntervalMs: number
  /** Minimum milliseconds between spoken comments. */
  screenCommentIntervalMs: number
}

export const VISION_MODE_PRESETS: Record<VisionMode, VisionModePreset> = {
  active: {
    captureIntervalMs: 2000,
    screenCommentIntervalMs: 8000,
  },
  eco: {
    captureIntervalMs: 10_000,
    screenCommentIntervalMs: 60_000,
  },
}

export const useVisionStore = defineStore('vision', () => {
  const providersStore = useProvidersStore()

  const activeProvider = useLocalStorageManualReset('settings/vision/active-provider', '')
  const activeModel = useLocalStorageManualReset('settings/vision/active-model', '')
  const activeCustomModelName = useLocalStorageManualReset('settings/vision/active-custom-model', '')
  const ollamaThinkingEnabled = useLocalStorageManualReset('settings/vision/ollama-thinking-enabled', false)
  const modelSearchQuery = refManualReset('')

  // Master switch for the desktop-pet "watch my screen and comment" behavior.
  // Kept off by default so the pet never captures the screen without explicit opt-in.
  const screenWatchEnabled = useLocalStorageManualReset('settings/vision/screen-watch-enabled', false)

  /**
   * Last formatted visual observation string (e.g. from Doubao vision inference), ready to be
   * injected into the consciousness model's context before the next LLM call.
   * Set by the screen-watch pipeline after a successful Doubao VLM inference; consumed and
   * cleared by chat-sync's `executeIngest` before calling `chatOrchestrator.ingest`.
   */
  const lastVisualObservation = ref('')

  /** Current vision mode — drives capture + comment interval presets. */
  const visionMode = useLocalStorageManualReset<VisionMode>('settings/vision/mode', 'eco')

  /**
   * Counter that increments each time the user asks the pet to "look" manually
   * (e.g. saying "看看" in chat). The screen-watch composable watches this and
   * fires a single capture+comment cycle bypassing throttle/dedup gates.
   */
  const manualLookRequest = ref(0)

  /**
   * Counter incremented when the user says "读单词" / "读英语". The screen-watch
   * composable watches this and fires a capture with the English OCR workload,
   * then speaks the result directly via TTS (no character reaction).
   */
  const englishReadRequest = ref(0)

  // Minimum spacing between two spoken screen comments. This is separate from the
  // capture cadence (`captureIntervalMs` in the processing store): frames may be grabbed
  // often for change detection, but the pet only speaks at most once per this window.
  const screenCommentIntervalMs = useLocalStorageManualReset<number>('settings/vision/screen-comment-interval-ms', 60_000)

  /**
   * Apply the preset intervals for the given mode and persist the mode choice.
   * Called once on store init (via the watcher below) and whenever the user
   * switches mode (chat command or settings UI).
   */
  function setVisionMode(mode: VisionMode) {
    const preset = VISION_MODE_PRESETS[mode]
    visionMode.value = mode
    // The processing store's captureIntervalMs watcher auto-restarts the ticker.
    const processingStore = useVisionProcessingStore()
    processingStore.captureIntervalMs = preset.captureIntervalMs
    screenCommentIntervalMs.value = preset.screenCommentIntervalMs
  }

  // Sync intervals whenever the persisted mode changes (covers cold-start and
  // cross-session restore).
  watch(visionMode, (mode) => {
    const preset = VISION_MODE_PRESETS[mode]
    const processingStore = useVisionProcessingStore()
    processingStore.captureIntervalMs = preset.captureIntervalMs
    screenCommentIntervalMs.value = preset.screenCommentIntervalMs
  }, { immediate: true })

  const providerMetadata = computed(() => {
    if (!activeProvider.value)
      return null

    return providersStore.providerMetadata[activeProvider.value] ?? null
  })

  const supportsModelListing = computed(() => {
    return providerMetadata.value?.capabilities.listModels !== undefined
  })

  const providerModels = computed(() => {
    if (!activeProvider.value)
      return []

    return providersStore.getModelsForProvider(activeProvider.value)
  })

  const isLoadingActiveProviderModels = computed(() => {
    if (!activeProvider.value)
      return false

    return providersStore.isLoadingModels[activeProvider.value] || false
  })

  const activeProviderModelError = computed(() => {
    if (!activeProvider.value)
      return null

    return providersStore.modelLoadError[activeProvider.value] || null
  })

  const configured = computed(() => {
    return !!activeProvider.value && !!activeModel.value
  })

  function resetModelSelection() {
    activeModel.reset()
    activeCustomModelName.reset()
    modelSearchQuery.reset()
  }

  async function loadModelsForProvider(provider: string) {
    if (provider && providerMetadata.value?.capabilities.listModels !== undefined) {
      await providersStore.fetchModelsForProvider(provider)
    }
  }

  async function getModelsForProvider(provider: string) {
    if (provider && providerMetadata.value?.capabilities.listModels !== undefined) {
      return providersStore.getModelsForProvider(provider)
    }

    return []
  }

  function resetState() {
    activeProvider.reset()
    resetModelSelection()
    screenWatchEnabled.reset()
    screenCommentIntervalMs.reset()
    visionMode.reset()
  }

  /** Pending resolver for when chat-sync is waiting on a manual look result. */
  let lookResolve: ((text: string) => void) | null = null

  function setVisualObservation(formatted: string) {
    lastVisualObservation.value = formatted
    // If chat-sync is waiting for this result, resolve the promise.
    if (lookResolve) {
      lookResolve(formatted)
      lookResolve = null
    }
  }

  function clearVisualObservation() {
    lastVisualObservation.value = ''
  }

  /**
   * Wait up to `timeoutMs` for a manual look result to arrive.
   * Used by chat-sync when the user says "看看" / "看屏幕" so the
   * LLM can reference what the pet saw on screen.
   */
  async function waitForLook(timeoutMs = 8000): Promise<string> {
    if (lastVisualObservation.value)
      return lastVisualObservation.value

    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        lookResolve = null
        resolve('')
      }, timeoutMs)
      lookResolve = (text: string) => {
        clearTimeout(timer)
        resolve(text)
      }
    })
  }

  /** Whether game-watch mode is active (uses screen:game-watch workload). */
  const gameWatchActive = ref(false)

  function setGameWatch(enabled: boolean) {
    gameWatchActive.value = enabled
  }

  /** Art studio mode — uses screen:art-studio workload. */
  const artMode = ref(false)

  /** Language mode: true = Japanese (ON), false = Chinese (OFF, default). */
  const japaneseMode = ref(false)

  function toggleJapanese() {
    japaneseMode.value = !japaneseMode.value
  }

  return {
    activeProvider,
    activeModel,
    customModelName: activeCustomModelName,
    ollamaThinkingEnabled,
    modelSearchQuery,
    screenWatchEnabled,
    screenCommentIntervalMs,
    visionMode,
    manualLookRequest,
    englishReadRequest,
    lastVisualObservation,

    supportsModelListing,
    providerModels,
    isLoadingActiveProviderModels,
    activeProviderModelError,
    configured,

    resetModelSelection,
    loadModelsForProvider,
    getModelsForProvider,
    setVisionMode,
    resetState,
    setVisualObservation,
    clearVisualObservation,
    waitForLook,
    gameWatchActive,
    setGameWatch,
    artMode,
    japaneseMode,
    toggleJapanese,
  }
})
