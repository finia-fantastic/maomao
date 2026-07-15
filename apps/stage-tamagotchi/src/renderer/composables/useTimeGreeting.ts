// When a VRM model first loads after app launch, speak a single short time-of-day
// greeting in Niko's voice (routed through the character speech pipeline). It never
// fires again this session: subsequent model switches (e.g. settings) don't repeat it.

import { useModelStore } from '@proj-airi/stage-ui-three'
import { useCharacterStore } from '@proj-airi/stage-ui/stores/character'
import { watch } from 'vue'

function pickGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 8)
    return 'おはよう、今日もいい天気だね。'
  if (h >= 8 && h < 11)
    return 'おはようございます。今日も一日、一緒に頑張ろうね。'
  if (h >= 11 && h < 14)
    return 'お昼だね、ちょっと休憩しない？'
  if (h >= 14 && h < 18)
    return 'こんにちは。そろそろお茶にしない？'
  if (h >= 18 && h < 21)
    return 'こんばんは。今日もお疲れさま。'
  if (h >= 21 && h < 24)
    return 'こんばんは。そろそろゆっくり休もうね。'
  return '遅くまでお疲れさま。無理しないでね。'
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
    // Speak only — no gesture.
    characterStore.emitTextOutput(text)
  })
}
