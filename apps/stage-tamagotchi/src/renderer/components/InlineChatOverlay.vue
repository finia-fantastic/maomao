<script setup lang="ts">
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatSyncStore } from '../stores/chat-sync'
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  'toggle': []
}>()

const chatSyncStore = useChatSyncStore()
const chatSessionStore = useChatSessionStore()
const { activeSessionId, sessionMessages } = storeToRefs(chatSessionStore)

const inputText = ref('')
const isSending = ref(false)
const replyText = ref('')
const replyVisible = ref(false)

// Auto-hide timer — cleared on new reply to prevent stale hides
let hideTimer: ReturnType<typeof setTimeout> | null = null

/** Calculate display duration based on text length (chars per second). */
function calcDisplayMs(text: string): number {
  const len = text.length
  // ~4 chars/sec reading speed, min 3s, max 15s
  return Math.min(Math.max(len * 250, 3000), 15000)
}

function showReply(text: string) {
  // Cancel any pending hide from a previous reply
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }

  replyText.value = text
  replyVisible.value = true

  // Auto-hide after calculated duration
  hideTimer = setTimeout(() => {
    replyVisible.value = false
    hideTimer = null
  }, calcDisplayMs(text))
}

// Watch for new assistant messages in current session
watch(() => sessionMessages.value[activeSessionId.value], (messages) => {
  if (!messages?.length) return
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  if (lastAssistant) {
    const text = getMessageText(lastAssistant)
    if (text) showReply(text)
  }
}, { deep: true })

function getMessageText(msg: any): string {
  if (msg.slices?.length) {
    return msg.slices
      .filter((s: any) => s.type === 'text')
      .map((s: any) => s.text)
      .join('')
  }
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('')
  }
  return ''
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isSending.value) return

  isSending.value = true
  inputText.value = ''

  try {
    await chatSyncStore.requestIngest({ text })
  }
  catch (e) {
    console.warn('[InlineChat] send failed:', e)
    showReply('发送失败，请重试。')
  }
  finally {
    isSending.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void sendMessage()
  }
}
</script>

<template>
  <!-- Toggle: shown when mode is OFF -->
  <button
    v-if="!visible"
    class="toggle-btn"
    @click="emit('toggle')"
  >
    💬
  </button>

  <Transition name="inline-chat">
    <div v-if="visible" class="chat-overlay">
      <!-- Toggle: shown when mode is ON -->
      <button
        class="toggle-btn active"
        @click="emit('toggle')"
      >
        ✕
      </button>
      <!-- Reply area: anchored at very top, expands downward only as needed -->
      <div class="reply-area">
        <Transition name="reply-fade">
          <div
            v-if="replyVisible && replyText"
            class="reply-box"
          >
            {{ replyText }}
          </div>
        </Transition>

        <div
          v-if="!replyVisible || !replyText"
          class="reply-box placeholder"
        >
          你好呀，可以直接和我说话～
        </div>
      </div>

      <!-- Spacer pushes input to bottom -->
      <div class="flex-1 pointer-events-none" />

      <!-- Input row (bottom) -->
      <div class="input-row">
        <input
          v-model="inputText"
          type="text"
          :disabled="isSending"
          placeholder="输入消息，按 Enter 发送..."
          class="chat-input"
          @keydown="handleKeydown"
        >
        <button
          :disabled="isSending || !inputText.trim()"
          class="send-btn"
          @click="sendMessage"
        >
          发送
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── Toggle button at top center ── */
.toggle-btn {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  border: none;
  border-radius: 50%;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(6px);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  transition: all 0.2s;
  color: #6366f1;
}
.toggle-btn.active {
  background: #6366f1;
  color: white;
}
.toggle-btn:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.dark .toggle-btn {
  background: rgba(40, 40, 55, 0.7);
  color: #818cf8;
}
.dark .toggle-btn.active {
  background: #6366f1;
  color: white;
}

/* ── Overlay: flex column, reply at very top, input at bottom ── */
.chat-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  padding: 0 8px 6px;
  /* Push content area down so input stays visible, but reply floats above */
  justify-content: flex-start;
}

/* ── Reply area: absolutely positioned at top, above character head ── */
.reply-area {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

/* ── Reply box: lightweight bubble, auto-sized ── */
.reply-box {
  pointer-events: auto;
  width: fit-content;
  min-width: 60px;
  max-width: min(300px, calc(100vw - 20px));
  height: auto;
  margin-top: 0;
  padding: 6px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow: visible;
  border-radius: 12px;
  box-sizing: border-box;
  font-size: 12.5px;
  line-height: 1.45;
  text-align: center;
  /* Light glass-morphism */
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  color: #374151;
  transition: opacity 0.25s, transform 0.25s;
}

.dark .reply-box {
  background: rgba(30, 30, 45, 0.78);
  border-color: rgba(100, 116, 139, 0.16);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: #d1d5db;
}

.reply-box.placeholder {
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid rgba(148, 163, 184, 0.08);
  box-shadow: none;
  color: #a8a29e;
  font-size: 12px;
}

.dark .reply-box.placeholder {
  background: rgba(40, 40, 55, 0.35);
  color: #78716c;
}

/* ── Input row ── */
.input-row {
  pointer-events: auto;
  display: flex;
  gap: 6px;
  width: 100%;
  max-width: 260px;
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  min-width: 0;
  border-radius: 10px;
  border: 1px solid rgba(209, 213, 219, 0.6);
  background: rgba(255, 255, 255, 0.72);
  padding: 7px 11px;
  font-size: 12.5px;
  outline: none;
  backdrop-filter: blur(8px);
  color: #111;
  transition: border-color 0.2s;
}

.chat-input::placeholder { color: #a8a29e; }

.chat-input:focus { border-color: #6366f1; }

.dark .chat-input {
  background: rgba(20, 20, 30, 0.78);
  border-color: rgba(75, 85, 99, 0.5);
  color: #e5e7eb;
}

.dark .chat-input::placeholder { color: #78716c; }

.send-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  background: #6366f1;
  color: white;
  padding: 7px 13px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.send-btn:hover { background: #4f46e5; }
.send-btn:disabled { opacity: 0.35; cursor: default; }

/* ── Transitions ── */
.inline-chat-enter-active,
.inline-chat-leave-active {
  transition: opacity 0.2s ease;
}
.inline-chat-enter-from,
.inline-chat-leave-to { opacity: 0; }

.reply-fade-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.reply-fade-leave-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.reply-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.reply-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
