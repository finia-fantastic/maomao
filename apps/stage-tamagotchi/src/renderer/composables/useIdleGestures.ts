// Periodically fire a random one of the 7 VRoid basic idle gestures so the character
// stays lively when the user isn't actively chatting or triggering dances. Each gesture
// is short (7-12s one-shot) and cross-fades back to idle on its own; the next random
// pick fires after a cooldown so it doesn't spam.

import { useModelStore } from '@proj-airi/stage-ui-three'
import { vrmGestureAnimations } from '@proj-airi/stage-ui-three/assets/vrm'

import { onScopeDispose, watch } from 'vue'

// The 7 VRoid basic actions (pixiv VRoid Project free motion pack) — short,
// self-contained one-shot gestures suitable for ambient idle "fidgeting".
const IDLE_GESTURE_NAMES = [
  '展示全身',
  '打招呼',
  '比耶',
  '射击',
  '转圈',
  '摆造型',
  '深蹲',
] as const

/** Pick an idle gesture at random from the pool, excluding the one just played. */
function pickNext(previousName?: string): string {
  const pool = IDLE_GESTURE_NAMES.filter(n => n !== previousName)
  return pool[Math.floor(Math.random() * pool.length)]
}

/** Random interval between MIN and MAX seconds (inclusive), in milliseconds. */
function randomIntervalMs(minS: number, maxS: number): number {
  return (minS + Math.random() * (maxS - minS)) * 1000
}

export function useIdleGestures() {
  const store = useModelStore()

  // Track when the last user-triggered gesture was requested so we don't
  // interrupt an active dance with a random idle fidget. Idle ticks that
  // fire within this window are skipped and rescheduled.
  let lastUserGestureTime = 0
  const USER_GESTURE_COOLDOWN_MS = 30_000

  // Watch gesturePlayRequest nonce — any new request (user dance, chat
  // trigger, etc.) resets the cooldown timer.
  watch(() => store.gesturePlayRequest?.nonce, (nonce) => {
    if (nonce != null) lastUserGestureTime = Date.now()
  })

  // Start background idle-gesture loop whenever a VRM model is loaded; stop when it
  // isn't (e.g. switch to Live2D or no model).
  watch(() => store.vrmModelLoaded, (loaded) => {
    if (loaded) start(); else stop()
  })

  // ------------------------------------------------------------------
  // Internal loop

  const MIN_IDLE_SECONDS = 45
  const MAX_IDLE_SECONDS = 95

  let timer: ReturnType<typeof setTimeout> | undefined
  let lastGesture: string | undefined

  function schedule() {
    cancel()
    timer = setTimeout(tick, randomIntervalMs(MIN_IDLE_SECONDS, MAX_IDLE_SECONDS))
  }

  function cancel() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  function tick() {
    if (!store.vrmModelLoaded)
      return

    // Skip if the drawing workstation is visible — don't break the pose.
    if (store.workstationVisible) {
      schedule()
      return
    }

    // Skip if a user/chat gesture was recently triggered — don't interrupt
    // an active dance with a random idle fidget.
    if (Date.now() - lastUserGestureTime < USER_GESTURE_COOLDOWN_MS) {
      schedule()
      return
    }

    const name = pickNext(lastGesture)
    const url = vrmGestureAnimations[name]
    if (url) {
      store.requestGesturePlay(url, {})
      lastGesture = name
    }
    schedule()
  }

  function start() {
    if (timer !== undefined)
      return  // already running
    schedule()
  }

  function stop() {
    cancel()
    lastGesture = undefined
  }

  onScopeDispose(() => {
    stop()
  })
}
