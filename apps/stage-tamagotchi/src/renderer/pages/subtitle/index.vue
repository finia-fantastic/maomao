<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

// ── State ──
const displayText = ref('')
const fullText = ref('')
const isTyping = ref(false)
const visible = ref(false)
const inputVisible = ref(false)
const inputText = ref('')
const isSending = ref(false)

let typeTimer: ReturnType<typeof setInterval> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let charIndex = 0
const CHARS_PER_TICK = 2
const TICK_MS = 45

// ── IPC listeners ──
const ipc = (window as any).electron?.ipcRenderer
if (!ipc) throw new Error('Subtitle page requires Electron IPC')

ipc.on('subtitle:display', (_e: any, text: string) => {
  fullText.value = text
  displayText.value = ''
  charIndex = 0
  visible.value = true
  isTyping.value = true
  clearTimers()
  startTyping()
})

ipc.on('subtitle:hide', () => {
  clearTimers()
  visible.value = false
  isTyping.value = false
})

ipc.on('subtitle:show-input', () => {
  inputVisible.value = true
  inputText.value = ''
})

ipc.on('subtitle:hide-input', () => {
  inputVisible.value = false
})

// ── Typing animation ──
function startTyping() {
  typeTimer = setInterval(() => {
    charIndex += CHARS_PER_TICK
    if (charIndex >= fullText.value.length) {
      displayText.value = fullText.value
      isTyping.value = false
      if (typeTimer) clearInterval(typeTimer)
      // Auto-hide after display
      const ms = Math.min(fullText.value.length * 100, 12000)
      hideTimer = setTimeout(() => {
        visible.value = false
      }, ms)
      return
    }
    displayText.value = fullText.value.slice(0, charIndex)
    // Pause on punctuation
    const ch = fullText.value[charIndex - 1] || ''
    if (/[，。！？、；：]/.test(ch)) charIndex -= 1 // slow down
  }, TICK_MS)
}

function clearTimers() {
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
}

// ── Input ──
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isSending.value) return
  isSending.value = true
  inputText.value = ''
  inputVisible.value = false
  await ipc.invoke('subtitle:send-message', text)
  // Show thinking
  fullText.value = '...'
  displayText.value = '...'
  visible.value = true
  isTyping.value = false
  isSending.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault()
    void sendMessage()
  }
  if (e.key === 'Escape') {
    inputVisible.value = false
    inputText.value = ''
    void ipc.invoke('subtitle:hide-input')
  }
}

// ── Lifecycle ──
onMounted(() => {
  // Register this page route
})

onUnmounted(() => {
  clearTimers()
})
</script>

<template>
  <div class="subtitle-overlay" :class="{ visible }">
    <!-- Subtitle text -->
    <Transition name="fade">
      <div v-if="visible && displayText" class="subtitle-text" @click="clearTimers(); displayText = fullText; isTyping = false">
        {{ displayText }}
        <span v-if="isTyping" class="cursor" />
      </div>
    </Transition>

    <!-- Input box -->
    <Transition name="fade">
      <div v-if="inputVisible" class="input-area">
        <input
          v-model="inputText"
          type="text"
          :disabled="isSending"
          placeholder="输入消息..."
          class="subtitle-input"
          autofocus
          @keydown="handleKeydown"
        >
        <button :disabled="isSending || !inputText.trim()" class="subtitle-send" @click="sendMessage">
          发送
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.subtitle-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.subtitle-text {
  pointer-events: auto;
  max-width: 100%;
  padding: 16px 28px;
  font-size: 30px;
  line-height: 1.5;
  color: #ffffff;
  text-align: center;
  text-shadow:
    -1px -1px 0 #00000088,
     1px -1px 0 #00000088,
    -1px  1px 0 #00000088,
     1px  1px 0 #00000088;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: pointer;
  user-select: none;
}

.cursor {
  display: inline-block;
  width: 3px;
  height: 26px;
  background: #ffffffcc;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.6s infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.input-area {
  pointer-events: auto;
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.subtitle-input {
  width: 300px;
  padding: 10px 16px;
  font-size: 16px;
  border: none;
  border-radius: 10px;
  background: rgba(30, 30, 40, 0.85);
  color: #fff;
  outline: none;
  backdrop-filter: blur(8px);
}

.subtitle-input::placeholder {
  color: #888;
}

.subtitle-send {
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  background: #6366f1;
  color: white;
  font-size: 15px;
  cursor: pointer;
}

.subtitle-send:disabled {
  opacity: 0.4;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.4s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<route lang="yaml">
meta:
  layout: blank
</route>
