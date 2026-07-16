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

// Watch for new assistant messages in current session
watch(() => sessionMessages.value[activeSessionId.value], (messages) => {
  if (!messages?.length) return
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  if (lastAssistant) {
    // Extract visible text from the message
    const text = getMessageText(lastAssistant)
    if (text) replyText.value = text
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
    // Use existing chat pipeline — same as typing in the chat panel
    await chatSyncStore.requestIngest({ text })
    // The watcher above will pick up the assistant response
  }
  catch (e) {
    console.warn('[InlineChat] send failed:', e)
    replyText.value = '发送失败，请重试。'
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
  <!-- Toggle button — always visible -->
  <button
    class="absolute right-2 top-2 z-50 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-all duration-200"
    :class="visible
      ? 'bg-primary-500 text-white hover:bg-primary-600'
      : 'bg-white/70 text-primary-600 hover:bg-white dark:bg-neutral-800/70 dark:text-primary-400'"
    @click="emit('toggle')"
  >
    {{ visible ? '退出聊天' : '💬 聊天' }}
  </button>

  <Transition name="inline-chat">
    <div v-if="visible" class="absolute inset-0 z-40 flex flex-col items-center justify-between px-3 py-4 pointer-events-none">
      <!-- Reply box (top) -->
      <div
        class="pointer-events-auto w-full max-w-[260px] rounded-xl px-3 py-2 text-sm leading-relaxed shadow-lg backdrop-blur-md transition-all"
        :class="replyText
          ? 'bg-primary-100/90 text-primary-900 dark:bg-primary-900/80 dark:text-primary-100'
          : 'bg-white/60 text-neutral-400 dark:bg-neutral-800/60 dark:text-neutral-500'"
        style="max-height: 120px; overflow-y: auto;"
      >
        {{ replyText || '你好呀，可以直接和我说话～' }}
      </div>

      <!-- Spacer: character sits in the middle -->
      <div class="flex-1 pointer-events-none" />

      <!-- Input box (bottom) -->
      <div class="pointer-events-auto w-full max-w-[260px] flex gap-1.5">
        <input
          v-model="inputText"
          type="text"
          :disabled="isSending"
          placeholder="输入消息，按 Enter 发送..."
          class="flex-1 rounded-lg border border-neutral-300/60 bg-white/80 px-3 py-2 text-sm outline-none backdrop-blur-sm transition-colors placeholder:text-neutral-400 focus:border-primary-400 dark:border-neutral-700/60 dark:bg-neutral-900/80 dark:text-white dark:placeholder:text-neutral-500"
          @keydown="handleKeydown"
        >
        <button
          :disabled="isSending || !inputText.trim()"
          class="rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-primary-600 disabled:opacity-40"
          @click="sendMessage"
        >
          发送
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.inline-chat-enter-active,
.inline-chat-leave-active {
  transition: opacity 0.2s ease;
}
.inline-chat-enter-from,
.inline-chat-leave-to {
  opacity: 0;
}
</style>
