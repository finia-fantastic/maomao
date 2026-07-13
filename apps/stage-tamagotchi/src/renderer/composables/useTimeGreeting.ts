// When a VRM model first loads after app launch, speak a single short time-of-day
// greeting in Niko's voice (routed through the character speech pipeline). It never
// fires again this session: subsequent model switches (e.g. settings) don't repeat it.

import { useCharacterStore } from '@proj-airi/stage-ui/stores/character'
import { useModelStore } from '@proj-airi/stage-ui-three'
import { vrmGestureAnimations } from '@proj-airi/stage-ui-three/assets/vrm'

import { watch } from 'vue'

function pickGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 8)
    return 'おはよう、今日もいい天気だね。' // 早上好(凌晨 5-8 点)
  if (h >= 8 && h < 11)
    return 'おはようございます。今日も一日、一緒に頑張ろうね。' // 早上好(8-11 点)
  if (h >= 11 && h < 14)
    return `お昼だね、ちょっと休憩しない？` // 中午(11-14 点)
  if (h >= 14 && h < 18)
    return 'こんにちは。そろそろお茶にしない？' // 下午(14-18 点)
  if (h >= 18 && h < 21)
    return 'こんばんは。今日もお疲れさま。' // 傍晚(18-21 点)
  if (h >= 21 && h < 24)
    return 'こんばんは。そろそろゆっくり休もうね。' // 晚上(21-0 点)
  return '遅くまでお疲れさま。無理しないでね。' // 深夜(0-5 点)
}

export function useTimeGreeting() {
  const modelStore = useModelStore()
  const characterStore = useCharacterStore()
  let didGreet = false

  watch(() => modelStore.vrmModelLoaded, (loaded) => {
    if (!loaded || didGreet)
      return
    didGreet = true

    const text = pickGreeting()

    // Speak the greeting. emitTextOutput opens a normal-priority queued speech
    // intent; by the time the model store's `vrmModelLoaded` flags true the
    // speech runtime is initialised, so we fire immediately — no setTimeout.
    characterStore.emitTextOutput(text)

    // Play the "打招呼" wave alongside the spoken greeting.
    const gestureUrl = vrmGestureAnimations['打招呼']
    if (gestureUrl)
      modelStore.requestGesturePlay(gestureUrl, {})
  })
}
