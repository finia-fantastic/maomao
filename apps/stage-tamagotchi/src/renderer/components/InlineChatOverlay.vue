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
  <Transition name="inline-chat">
    <div v-if="visible" class="absolute inset-0 z-40 flex flex-col items-center pointer-events-none" style="padding-top: 6px; padding-bottom: 10px;">
      <!-- Reply box (top, above character head) -->
      <Transition name="reply-fade">
        <div
          v-if="replyVisible && replyText"
          class="reply-box"
        >
          {{ replyText }}
        </div>
      </Transition>

      <!-- Placeholder when no reply yet -->
      <div
        v-if="!replyVisible || !replyText"
        class="reply-box placeholder"
      >
        你好呀，可以直接和我说话～
      </div>

      <!-- Spacer: character sits in the middle -->
      <div class="flex-1 pointer-events-none" />

      <!-- Input box (bottom) -->
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
/* ── Reply box: content-driven sizing, no scrollbars ── */
.reply-box {
  pointer-events: auto;
  width: fit-content;
  min-width: 80px;
  max-width: min(320px, calc(100vw - 24px));
  height: auto;
  min-height: 36px;
  padding: 8px 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow: visible;
  border-radius: 14px;
  box-sizing: border-box;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(12px);
  background: rgba(59, 130, 246, 0.12);
  color: #1e3a5f;
}

.dark .reply-box {
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
}

.reply-box.placeholder {
  background: rgba(255, 255, 255, 0.5);
  color: #9ca3af;
}

.dark .reply-box.placeholder {
  background: rgba(30, 30, 30, 0.5);
  color: #6b7280;
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
  background: rgba(255, 255, 255, 0.75);
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
  backdrop-filter: blur(8px);
  color: #111;
  transition: border-color 0.2s;
}

.chat-input::placeholder {
  color: #9ca3af;
}

.chat-input:focus {
  border-color: #3b82f6;
}

.dark .chat-input {
  background: rgba(20, 20, 30, 0.8);
  border-color: rgba(75, 85, 99, 0.6);
  color: #e5e7eb;
}

.dark .chat-input::placeholder {
  color: #6b7280;
}

.send-btn {
  flex-shrink: 0;
  border: none;
  border-radius: 10px;
  background: #3b82f6;
  color: white;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.send-btn:hover {
  background: #2563eb;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* ── Transitions ── */
.inline-chat-enter-active,
.inline-chat-leave-active {
  transition: opacity 0.2s ease;
}
.inline-chat-enter-from,
.inline-chat-leave-to {
  opacity: 0;
}

.reply-fade-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.reply-fade-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.reply-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.reply-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
