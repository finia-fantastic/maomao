import type { WebSocketEventOf } from '@proj-airi/server-sdk'
import type { VisionWorkloadId } from '@proj-airi/stage-ui/composables'
import type { SourcesOptions } from 'electron'
import type { Ref } from 'vue'

import { errorMessageFrom } from '@moeru/std'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useVisionOrchestratorStore } from '@proj-airi/stage-ui/stores/modules/vision/orchestrator'
import { useVisionProcessingStore } from '@proj-airi/stage-ui/stores/modules/vision/processing-store'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision/store'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'

import { useVisionScreenCapture } from './use-vision-screen-capture'

/**
 * Perceptual hash of a captured frame used for change-detection dedup.
 *
 * Stored as a compact Uint8Array to keep comparison cheap: a small grayscale
 * down-sample (e.g. 16×16 = 256 bytes) is enough to tell whether the user
 * switched apps or scrolled significantly.
 */
interface FrameSignature {
  width: number
  height: number
  /** Row-major luminance values 0–255. */
  data: Uint8Array
}

/**
 * Mean-absolute-difference threshold below which two frames are considered
 * "the same".  Tuned empirically — small enough to still catch app switches
 * and large scrolls, large enough to ignore clock updates and cursor blinks.
 */
const SIGNATURE_SIMILARITY_THRESHOLD = 0.03

/** Size of the down-sampled luminance grid used for frame signatures. */
const SIGNATURE_SIZE = 16

/**
 * Sources options for a persistent headless capture loop.
 *
 * We only ask for display-level sources (`types: ['screen']`) to keep the set
 * small and avoid the overhead of per-window thumbnail fetching.
 */
const SCREEN_WATCH_SOURCES_OPTIONS: SourcesOptions = {
  types: ['screen'],
  fetchWindowIcons: false,
}

/** Workload used to get a natural-language commentary from the vision model. */
const SCREEN_WATCH_WORKLOAD: VisionWorkloadId = 'screen:commentary'

/**
 * Compute a lightweight perceptual signature of a video frame.
 *
 * The frame is down-sampled to a {@link SIGNATURE_SIZE} × {@link SIGNATURE_SIZE}
 * grayscale grid and the per-pixel luminance is returned as a flat Uint8Array.
 * This signature is cheap enough to run on every captured frame (~hundreds of
 * pixels vs. million-pixel canvas), and its mean-absolute-difference against a
 * previous signature serves as a simple but effective screen-change detector.
 */
function captureSignature(video: HTMLVideoElement): FrameSignature | null {
  if (!video || video.readyState < 2)
    return null

  const canvas = document.createElement('canvas')
  canvas.width = SIGNATURE_SIZE
  canvas.height = SIGNATURE_SIZE

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx)
    return null

  // Down-sample to a tiny grayscale strip — GPU handles scaling for us.
  ctx.filter = 'grayscale(100%)'
  ctx.drawImage(video, 0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE)

  const imageData = ctx.getImageData(0, 0, SIGNATURE_SIZE, SIGNATURE_SIZE)
  return {
    width: SIGNATURE_SIZE,
    height: SIGNATURE_SIZE,
    // `imageData.data` is a `Uint8ClampedArray`; convert to plain `Uint8Array`
    // so the signature's `data` field has the narrower type.
    data: new Uint8Array(imageData.data.filter((_, index) => index % 4 === 0)),
  }
}

/**
 * Returns a value 0–1 indicating how "different" two signatures are.
 * 0 = identical; 1 = completely different.
 */
function signatureDifference(a: FrameSignature, b: FrameSignature): number {
  if (a.width !== b.width || a.height !== b.height)
    return 1

  let totalDiff = 0
  for (let index = 0; index < a.data.length; index += 1) {
    totalDiff += Math.abs(a.data[index] - b.data[index])
  }
  return totalDiff / (a.data.length * 255)
}

/**
 * Persistent "watch my screen" composable for the desktop pet.
 *
 * When the user enables screen-watch in settings, this composable starts an
 * interval-based capture loop that:
 * 1. Grabs the current screen frame at `captureIntervalMs` cadence.
 * 2. Checks a per-frame perceptual signature against the last commented frame.
 * 3. If the frame changed enough AND the comment throttle has elapsed, sends
 *    one frame to the vision model for a natural-language summary.
 * 4. Routes that summary through the character orchestrator as a spark:notify
 *    event so the pet reacts in character + speaks via TTS.
 *
 * Screen capture always goes through the first available display source
 * (auto-selected via `electron-screen-capture` without a native picker).
 * If no source is available or the stream dies, the loop silently retries
 * with backoff.
 *
 * @param videoRef - A `<video>` element reference that will be used to render
 *   the captured MediaStream. The caller is responsible for providing an
 *   off-DOM element (e.g. `document.createElement('video')`).
 */
export function useVisionScreenWatch(videoRef: Ref<HTMLVideoElement | null>) {
  const visionStore = useVisionStore()
  const visionProcessingStore = useVisionProcessingStore()
  const visionOrchestratorStore = useVisionOrchestratorStore()
  const characterOrchestratorStore = useCharacterOrchestratorStore()

  // The orchestrator's `processCapture` already checks provider/model internally.
  const { screenWatchEnabled, screenCommentIntervalMs } = storeToRefs(visionStore)
  const { captureIntervalMs } = storeToRefs(visionProcessingStore)

  const {
    sources,
    activeSourceId,
    activeStream,
    startStream,
    stopStream,
    cleanup,
    captureFrame,
    refetchSources,
  } = useVisionScreenCapture(() => SCREEN_WATCH_SOURCES_OPTIONS)

  // ------ runtime state ---------------------------------------------------

  /** Track the last time the pet actually spoke (millisecond epoch). */
  const lastSpokeAt = ref(0)

  /**
   * Signature of the frame that last triggered a spoken comment.
   * Used for change-detection dedup: we only speak again when the screen
   * differs significantly from this baseline.
   */
  const lastSpokeSignature = ref<FrameSignature | null>(null)

  /** Whether the VLM is currently processing a capture. Prevents overlapping runs. */
  const isInferring = ref(false)

  /** Cached pet window screen bounds for self-masking in vision captures. */
  const petWindowBounds = ref<{ x: number, y: number, width: number, height: number } | null>(null)
  /** Timestamp of the last bounds refresh. */
  let boundsLastFetchedAt = 0
  /** Minimum interval between bounds IPC calls (ms). */
  const BOUNDS_REFRESH_MS = 5000

  /** Ring buffer of the last few vision comments to prevent repetition. */
  const recentComments: string[] = []
  /** Max number of recent comments to track. */
  const MAX_RECENT_COMMENTS = 5

  /** Backoff state for stream re-acquisition after failure. */
  const nextRetryAt = ref(0)

  let intervalHandle: ReturnType<typeof setInterval> | null = null

  // ------ helpers ---------------------------------------------------------

  function isStreamLive(): boolean {
    const stream = activeStream.value
    if (!stream)
      return false
    return stream.getVideoTracks().some(track => track.readyState === 'live')
  }

  /**
   * Acquire (or re-acquire) the display capture stream.
   *
   * Strategy:
   * - Fetch sources once to populate the list, then pick the first display.
   * - The `selectWithSource` call in `startStream` sets the source on the
   *   main process so `getDisplayMedia` returns it without a picker.
   * - On failure, set a backoff timestamp to avoid tight retry loops.
   */
  async function ensureStream(): Promise<MediaStream | null> {
    if (isStreamLive())
      return activeStream.value!

    if (Date.now() < nextRetryAt.value)
      return null

    try {
      // Refresh sources to get fresh display handles (monitor plug/unplug).
      await refetchSources()

      const displaySource = sources.value.find(
        source => source.id.startsWith('screen:'),
      )
      if (!displaySource) {
        // No display source found — user may not have any screens captured.
        // Back off 30 s before retrying.
        nextRetryAt.value = Date.now() + 30_000
        return null
      }

      activeSourceId.value = displaySource.id
      const stream = await startStream()

      const video = videoRef.value
      if (video) {
        video.srcObject = stream
        await video.play()

        // Wait for the video to have actual frame data before returning.
        if (video.readyState < 2) {
          await new Promise<void>((resolve) => {
            const onReady = () => {
              video.removeEventListener('loadedmetadata', onReady)
              resolve()
            }
            video.addEventListener('loadedmetadata', onReady)
          })
        }
      }

      return stream
    }
    catch (error) {
      // Silently back off — most likely permission denied or source disappeared.
      // NOTICE: Only log to console; do not surface errors to the user.
      // The pet should just stay quiet until capture works again.
      console.warn('[VisionScreenWatch] Failed to acquire stream:', errorMessageFrom(error) ?? 'Unknown error')
      nextRetryAt.value = Date.now() + 15_000
      return null
    }
  }

  /**
   * Build a spark:notify event payload from a VLM screen summary so the
   * character orchestrator can turn it into an in-character spoken comment.
   */
  function buildScreenCommentNotify(text: string): WebSocketEventOf<'spark:notify'> {
    // Build anti-repetition note: tell the consciousness model what was recently
    // said so it can vary the reaction and avoid repeating the same observation.
    let antiRepeatNote = 'The AI pet noticed this on your screen and wants to comment on it in character.'
    if (recentComments.length > 0) {
      const recentList = recentComments.map((c, i) => `${i + 1}. "${c}"`).join('\n')
      antiRepeatNote += `\n\nANTI-REPETITION: You recently said these things. Do NOT repeat them or say anything similar. Say something NEW and DIFFERENT:\n${recentList}`
    }

    return {
      type: 'spark:notify',
      source: 'vision:screen-watch',
      data: {
        id: `vision-screen-watch-${nanoid(8)}`,
        eventId: `vision-screen-watch-${nanoid(8)}`,
        kind: 'ping' as const,
        urgency: 'immediate' as const,
        headline: text,
        note: antiRepeatNote,
        destinations: ['character'],
        metadata: {
          module: 'vision',
          workload: SCREEN_WATCH_WORKLOAD,
        },
      },
    }
  }

  /**
   * Refresh cached pet window screen bounds via IPC.
   *
   * Debounced to at most one call every {@link BOUNDS_REFRESH_MS}ms.
   * The bounds are used to paint a self-mask on vision captures so the
   * model doesn't see and comment on its own avatar.
   */
  async function refreshPetWindowBounds() {
    const now = Date.now()
    if (now - boundsLastFetchedAt < BOUNDS_REFRESH_MS)
      return // still fresh enough
    boundsLastFetchedAt = now
    try {
      const bounds = await (window as any).electron.ipcRenderer.invoke('get-pet-window-bounds')
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        petWindowBounds.value = bounds
      }
    }
    catch {
      // Silently ignore — mask is a nice-to-have, not a hard requirement
    }
  }

  // ------ tick (capture -> VLM -> speak) ----------------------------------

  /**
   * Single tick of the screen-watch loop.
   *
   * @param force - When true, bypass the dedup gate (screen hasn't changed enough)
   *   and the throttle gate (minimum spacing between comments). Used for manual
   *   "look now" triggers from chat commands.
   *
   * Order:
   * 1. Bail early if stream is dead (retry next tick with backoff).
   * 2. Capture current frame + its perceptual signature.
   * 3. Skip if screen hasn't changed enough since last comment (unless forced).
   * 4. Skip if comment throttle hasn't elapsed (unless forced).
   * 5. Run VLM inference to get natural-language commentary.
   * 6. Fire a spark:notify so the pet reacts and speaks.
   */
  async function tick(force = false) {
    if (isInferring.value) {
      console.info('[Vision] skipped: previous inference still running')
      return
    }

    // Re-acquire stream if needed; silent no-op if stream is already live.
    console.info('[Vision] acquiring stream...')
    const stream = await ensureStream()
    if (!stream) {
      console.warn('[Vision] no stream available (check screen capture permission)')
      return
    }
    console.info('[Vision] stream acquired')

    const video = videoRef.value
    if (!video) {
      console.warn('[Vision] no video element')
      return
    }

    const signature = captureSignature(video)
    if (!signature) {
      console.warn('[Vision] video not ready (readyState < 2)')
      return
    }

    // ---- dedup gate: has the screen changed enough? --------------------
    if (!force && lastSpokeSignature.value) {
      const diff = signatureDifference(signature, lastSpokeSignature.value)
      if (diff < SIGNATURE_SIMILARITY_THRESHOLD) {
        console.info('[Vision] screen unchanged, skipped')
        return
      }
    }

    // ---- throttle gate: minimum spacing between comments ---------------
    const now = Date.now()
    const elapsedSinceLastSpoke = now - lastSpokeAt.value
    if (!force && elapsedSinceLastSpoke < screenCommentIntervalMs.value) {
      console.info(`[Vision] throttled, next comment in ${screenCommentIntervalMs.value - elapsedSinceLastSpoke}ms`)
      return
    }

    // ---- capture frame for VLM -----------------------------------------
    // Refresh pet window bounds before each capture so the mask stays
    // accurate even when the user drags/resizes the pet window.
    await refreshPetWindowBounds()

    const maskRegions = petWindowBounds.value
      ? [petWindowBounds.value]
      : undefined

    const dataUrl = captureFrame(video, 0.82, 1280, 720, maskRegions)
    if (!dataUrl) {
      console.warn('[Vision] frame capture failed')
      return
    }
    console.info('[Vision] frame captured, sending to VLM...')

    isInferring.value = true

    try {
      // Run VLM inference to get a natural-language description of the screen.
      const result = await visionOrchestratorStore.processCapture({
        imageDataUrl: dataUrl,
        workloadId: SCREEN_WATCH_WORKLOAD,
        sourceId: activeSourceId.value,
        capturedAt: now,
        publishContext: false,
      })

      const text = result.text
      console.info(`[Vision] VLM response received: ${text ? `${text.slice(0, 100)}...` : 'EMPTY'}`)
      if (!text || text.length === 0) {
        console.warn('[Vision] VLM returned empty text — no reaction')
        return
      }

      // Update dedup baseline BEFORE speaking so concurrent ticks don't slip through.
      lastSpokeSignature.value = signature
      lastSpokeAt.value = now

      // Fire spark:notify for the pet to speak via TTS only.
      // Do NOT store in setVisualObservation — that would leak auto-watch
      // observations into chat context and show them as visible messages.
      await characterOrchestratorStore.handleSparkNotifyWithReaction(
        buildScreenCommentNotify(text),
        { fallbackText: text },
      )

      // Track this comment in the ring buffer so the next vision cycle
      // can tell the consciousness model what not to repeat.
      recentComments.push(text)
      if (recentComments.length > MAX_RECENT_COMMENTS)
        recentComments.shift()
    }
    catch (error) {
      console.warn('[VisionScreenWatch] Inference or reaction failed:', errorMessageFrom(error) ?? 'Unknown error')
    }
    finally {
      isInferring.value = false
    }
  }

  // ------ manual trigger --------------------------------------------------

  /**
   * Force a single capture+comment cycle immediately, bypassing the dedup and
   * throttle gates. Called when the user says "看看" / "look" in chat.
   *
   * Uses desktopCapturer IPC (no system permission dialog) instead of the
   * MediaStream pipeline, so manual looks work even when screen-watch is off.
   */
  async function triggerManualLook() {
    if (isInferring.value) {
      console.info('[Vision] manual look skipped: already inferring')
      return
    }

    isInferring.value = true

    try {
      // Step 1: capture screen via desktopCapturer IPC
      console.info('[Vision] manual look: capturing screen...')
      const result = await (window as any).electron.ipcRenderer.invoke('screen-capture:capture')
      const rawDataUrl = result?.dataUrl
      if (!rawDataUrl) {
        console.warn('[Vision] manual look FAIL: screen-capture returned no data')
        visionStore.setVisualObservation('（截屏失败，无法获取屏幕画面）')
        return
      }
      console.info(`[Vision] manual look: captured ${rawDataUrl.length} chars`)

      // Step 2: mask pet window
      await refreshPetWindowBounds()
      let maskedDataUrl = rawDataUrl
      if (petWindowBounds.value) {
        console.info('[Vision] manual look: applying self-mask...')
        maskedDataUrl = await applyMaskToDataUrl(rawDataUrl, petWindowBounds.value)
      }

      // Step 3: VLM inference
      console.info('[Vision] manual look: sending to VLM...')
      const now = Date.now()
      const vlmResult = await visionOrchestratorStore.processCapture({
        imageDataUrl: maskedDataUrl,
        workloadId: 'screen:chat-look',
        sourceId: 'manual-look',
        capturedAt: now,
        publishContext: false,
      })

      const text = vlmResult.text
      console.info(`[Vision] manual look VLM result: "${text ? text.slice(0, 120) : 'EMPTY'}"`)
      if (!text || text.length === 0) {
        console.warn('[Vision] manual look FAIL: VLM returned empty')
        visionStore.setVisualObservation('（视觉模型未返回描述，可能是API配置问题）')
        return
      }

      // Store for chat-sync to pick up
      visionStore.setVisualObservation(text)

      // Track for anti-repetition
      recentComments.push(text)
      if (recentComments.length > MAX_RECENT_COMMENTS)
        recentComments.shift()
    }
    catch (error) {
      const msg = errorMessageFrom(error) ?? 'Unknown error'
      console.warn('[Vision] manual look FAIL:', msg)
      visionStore.setVisualObservation(`（截屏分析失败：${msg}）`)
    }
    finally {
      isInferring.value = false
    }
  }

  /**
   * Apply a mask rectangle to a data URL image, returning a new data URL.
   * Loads the image, draws a dark rectangle over the mask region, and exports.
   */
  async function applyMaskToDataUrl(dataUrl: string, bounds: { x: number, y: number, width: number, height: number }): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0)
        // Clamp mask bounds to image size
        const mx = Math.max(0, Math.round(bounds.x))
        const my = Math.max(0, Math.round(bounds.y))
        const mw = Math.min(canvas.width - mx, Math.round(bounds.width))
        const mh = Math.min(canvas.height - my, Math.round(bounds.height))
        if (mw > 0 && mh > 0) {
          ctx.fillStyle = '#1a1a2e'
          ctx.fillRect(mx, my, mw, mh)
        }
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    })
  }

  // Watch the store's manualLookRequest counter — each increment triggers one
  // forced capture+comment regardless of interval/throttle state.
  watch(() => visionStore.manualLookRequest, () => {
    void triggerManualLook()
  })

  /**
   * "读单词" — capture screen, OCR English text via VLM, speak via TTS directly.
   * Unlike the commentary path, this bypasses the character reaction LLM and
   * feeds the VLM result straight into TTS.
   */
  async function triggerEnglishRead() {
    if (isInferring.value)
      return

    const stream = await ensureStream()
    if (!stream)
      return

    const video = videoRef.value
    if (!video)
      return

    await refreshPetWindowBounds()
    const maskRegions = petWindowBounds.value ? [petWindowBounds.value] : undefined

    const dataUrl = captureFrame(video, 0.82, 1280, 720, maskRegions)
    if (!dataUrl)
      return

    isInferring.value = true
    try {
      const result = await visionOrchestratorStore.processCapture({
        imageDataUrl: dataUrl,
        workloadId: 'screen:english-reader',
        sourceId: activeSourceId.value,
        capturedAt: Date.now(),
        publishContext: false,
      })

      const text = result.text
      if (!text || text.length === 0)
        return

      // Speak the recognized English directly via TTS, no character reaction.
      characterOrchestratorStore.handleSparkNotifyWithReaction(
        buildScreenCommentNotify(text),
        { fallbackText: text },
      )
    }
    finally {
      isInferring.value = false
    }
  }

  // Watch englishReadRequest — each increment triggers one English OCR + TTS cycle.
  watch(() => visionStore.englishReadRequest, () => {
    void triggerEnglishRead()
  })

  // ------ lifecycle -------------------------------------------------------

  function startLoop() {
    if (intervalHandle)
      return

    // Fire immediately on first enable, then at the capture interval.
    void tick()
    intervalHandle = setInterval(() => {
      void tick()
    }, captureIntervalMs.value)
  }

  function stopLoop() {
    if (!intervalHandle)
      return
    clearInterval(intervalHandle)
    intervalHandle = null

    stopStream()
    lastSpokeAt.value = 0
    lastSpokeSignature.value = null
    nextRetryAt.value = 0
  }

  /**
   * TODO: This workload needs a "casual commentary" prompt that tells the
   * vision model to describe the screen in a friendly, conversational tone
   * suitable for the pet to react to. For now we fall back to screen:understand.
   * When a proper prompt is defined, switch `SCREEN_WATCH_WORKLOAD` to it.
   */
  // REVIEW: The `screen:commentary` workload does not exist yet in
  // `use-vision-workloads.ts`. We should add one with a prompt like:
  // "Describe what's on screen in a simple, casual way a pet AI could
  //  comment on. Focus on what app is visible and any interesting activity."

  // When screen-watch is toggled on, start the loop; when off, stop.
  watch(screenWatchEnabled, (enabled) => {
    if (enabled) {
      startLoop()
    }
    else {
      stopLoop()
    }
  }, { immediate: true })

  // Adapt the ticker interval in real-time when user changes capture cadence.
  watch(captureIntervalMs, () => {
    if (!screenWatchEnabled.value || !intervalHandle)
      return
    // Restart with the new interval.
    clearInterval(intervalHandle)
    intervalHandle = setInterval(() => {
      void tick()
    }, captureIntervalMs.value)
  })

  // Full teardown when the owning component unmounts.
  onScopeDispose(() => {
    stopLoop()
    cleanup()
    if (videoRef.value) {
      videoRef.value.pause()
      videoRef.value.srcObject = null
    }
  })

  return { triggerManualLook }
}
