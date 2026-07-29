import type { WebSocketEventInputs } from '@proj-airi/server-sdk'
import type { ToolCallRerunPayload } from '@proj-airi/stage-ui/stores/tool-call-rerun'
import type { ChatHistoryItem, StreamingAssistantMessage } from '@proj-airi/stage-ui/types/chat'
import type { ChatSessionMeta } from '@proj-airi/stage-ui/types/chat-session'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { errorMessageFrom } from '@moeru/std'

import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { useModelStore } from '@proj-airi/stage-ui-three'
import { vrmGestureAnimations } from '@proj-airi/stage-ui-three/assets/vrm'
import { extractMessageText } from '@proj-airi/stage-ui/libs/chat-sync/wire-message'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'

import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { resolveLlmTools } from '@proj-airi/stage-ui/stores/llm-tool-resolver'
import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useWorkingMemoryStore } from '@proj-airi/stage-ui/stores/modules/memory'
import { useVisionOrchestratorStore } from '@proj-airi/stage-ui/stores/modules/vision/orchestrator'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision/store'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { executeToolCallRerun } from '@proj-airi/stage-ui/stores/tool-call-rerun'
import { defineStore, storeToRefs } from 'pinia'
import { ref, watch } from 'vue'

import { drawImageTools } from './tools/builtin/drawImage'
import { drawSvgTools } from './tools/builtin/drawSvg'
import { fetchUrlTools } from './tools/builtin/fetchUrl'
import { gameControlTools } from './tools/builtin/gameControl'
import { rocoBattleTools } from './tools/builtin/rocoBattle'
import { storeMemoryTools } from './tools/builtin/storeMemory'
import { imageJournalTools } from './tools/builtin/image-journal'
import { vocabularyTools } from './tools/builtin/vocabulary'
import { vrmAnimationTools } from './tools/builtin/vrmAnimation'
import { weatherTools } from './tools/builtin/weather'
import { webpageTools } from './tools/builtin/webpage'
import { widgetsTools } from './tools/builtin/widgets'

type ChatSyncMode = 'inactive' | 'authority' | 'follower'
type ToolsetId = 'widgets' | 'artistry'

interface AttachmentPayload {
  type: 'image'
  data: string
  mimeType: string
}

interface SessionSnapshotPayload {
  activeSessionId: string
  sessionMessages: Record<string, ChatHistoryItem[]>
  sessionMetas: Record<string, ChatSessionMeta>
}

interface StreamSnapshotPayload {
  sending: boolean
  streamingMessage: StreamingAssistantMessage
}

interface IngestCommandPayload {
  text: string
  attachments?: AttachmentPayload[]
  input?: WebSocketEventInputs
  sessionId?: string
  toolset?: ToolsetId
}

interface SpotlightIngestPayload {
  text: string
}

interface SpotlightIngestResult {
  sessionId: string
  visibleText: string
}

interface ChatCommandMessage<C extends string = string, P = unknown> {
  type: 'command'
  authorityId?: string
  requestId: string
  senderId: string
  command: C
  payload: P
}

interface RetryCommandPayload {
  sessionId?: string
  index: number
}

type ChatResponsePayload
  = | { ok: true, result?: SpotlightIngestResult }
    | { ok: false, error?: string }

type ChatSyncMessage
  = | { type: 'authority-announcement', authorityId: string, sentAt: number }
    | { type: 'request-snapshot', requestId: string, senderId: string }
    | { type: 'session-snapshot', authorityId: string, snapshot: SessionSnapshotPayload }
    | { type: 'stream-snapshot', authorityId: string, snapshot: StreamSnapshotPayload }
    | ChatCommandMessage<'ingest', IngestCommandPayload>
    | ChatCommandMessage<'spotlight-ingest', SpotlightIngestPayload>
    | ChatCommandMessage<'retry', RetryCommandPayload>
    | ChatCommandMessage<'tool-call-rerun', ToolCallRerunPayload<ToolsetId>>
    | ChatCommandMessage<'cleanup', { sessionId?: string }>
    | ChatCommandMessage<'delete-message', { sessionId?: string, messageId?: string, index?: number }>
    | ({ type: 'response', requestId: string, authorityId: string } & ChatResponsePayload)

interface PendingRequest {
  resolve: (result?: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const CHAT_SYNC_CHANNEL_NAME = 'airi:stage-tamagotchi:chat-sync'
const AUTHORITY_HEARTBEAT_INTERVAL_MS = 1000
const REQUEST_TIMEOUT_MS = 30000
const SPOTLIGHT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function getRetryText(message: ChatHistoryItem | undefined): string | null {
  if (!message || message.role !== 'user')
    return null

  if (typeof message.content === 'string') {
    const text = message.content.trim()
    return text || null
  }

  if (!Array.isArray(message.content))
    return null

  const text = message.content.reduce<string[]>((texts, part) => {
    if (part.type !== 'text')
      return texts

    const value = part.text?.trim()
    if (value)
      texts.push(value)

    return texts
  }, []).join('\n\n')

  return text || null
}

function resolveRetrySourceIndex(messages: ChatHistoryItem[], index: number): number {
  const targetMessage = messages[index]
  if (!targetMessage)
    return -1

  if (targetMessage.role === 'user')
    return index

  if (targetMessage.role === 'assistant' || targetMessage.role === 'error') {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor]?.role === 'user')
        return cursor
    }
  }

  return -1
}

function previewChatSyncPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload
  }

  const record = payload as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text : undefined

  return {
    ...record,
    text: text && text.length > 160 ? `${text.slice(0, 160)}...` : text,
    attachments: Array.isArray(record.attachments)
      ? `[${record.attachments.length} attachment(s)]`
      : record.attachments,
  }
}

function logChatSyncError(message: string, error: unknown, details: Record<string, unknown>) {
  console.error(`[chat-sync] ${message}`, {
    ...details,
    error,
    errorMessage: errorMessageFromValue(error),
  })
}

export const useChatSyncStore = defineStore('stage-tamagotchi:chat-sync', () => {
  const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const mode = ref<ChatSyncMode>('inactive')
  const authorityId = ref<string | null>(null)

  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const { cleanupMessages } = useChatMaintenanceStore()
  const providersStore = useProvidersStore()
  const consciousnessStore = useConsciousnessStore()
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
  const { activeSessionId, sessionMessages, sessionMetas } = storeToRefs(chatSession)
  const { streamingMessage } = storeToRefs(chatStream)
  const { sending } = storeToRefs(chatOrchestrator)

  const pendingRequests = new Map<string, PendingRequest>()
  const stopSyncWatchers: Array<() => void> = []
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let channel: BroadcastChannel | null = null

  function post(message: ChatSyncMessage) {
    channel?.postMessage(message)
  }

  function buildSessionSnapshot(): SessionSnapshotPayload {
    return chatSession.getSnapshot()
  }

  function buildStreamSnapshot(): StreamSnapshotPayload {
    return {
      sending: sending.value,
      streamingMessage: JSON.parse(JSON.stringify(streamingMessage.value)) as StreamingAssistantMessage,
    }
  }

  function broadcastAuthorityAnnouncement() {
    if (mode.value !== 'authority')
      return

    post({
      type: 'authority-announcement',
      authorityId: instanceId,
      sentAt: Date.now(),
    })
  }

  function broadcastSessionSnapshot() {
    if (mode.value !== 'authority')
      return

    post({
      type: 'session-snapshot',
      authorityId: instanceId,
      snapshot: buildSessionSnapshot(),
    })
  }

  function broadcastStreamSnapshot() {
    if (mode.value !== 'authority')
      return

    post({
      type: 'stream-snapshot',
      authorityId: instanceId,
      snapshot: buildStreamSnapshot(),
    })
  }

  function stopWatchers() {
    while (stopSyncWatchers.length > 0) {
      const stop = stopSyncWatchers.pop()
      stop?.()
    }
  }

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
  }

  function registerAuthorityWatchers() {
    stopSyncWatchers.push(
      watch([activeSessionId, sessionMessages, sessionMetas], () => {
        broadcastSessionSnapshot()
      }, { deep: true, immediate: true }),
      watch([sending, streamingMessage], () => {
        broadcastStreamSnapshot()
      }, { deep: true, immediate: true }),
    )

    broadcastAuthorityAnnouncement()
    clearHeartbeat()
    heartbeatTimer = setInterval(() => {
      broadcastAuthorityAnnouncement()
    }, AUTHORITY_HEARTBEAT_INTERVAL_MS)
  }

  function applySessionSnapshot(snapshot: SessionSnapshotPayload) {
    const localActiveSessionId = activeSessionId.value
    const shouldPreserveLocalActiveSession = mode.value === 'follower'
      && !!localActiveSessionId
      && !!snapshot.sessionMessages[localActiveSessionId]

    chatSession.applyRemoteSnapshot({
      ...snapshot,
      activeSessionId: shouldPreserveLocalActiveSession
        ? localActiveSessionId
        : snapshot.activeSessionId,
    })
  }

  function applyStreamSnapshot(snapshot: StreamSnapshotPayload) {
    chatOrchestrator.sending = snapshot.sending
    chatStream.streamingMessage = snapshot.streamingMessage
  }

  function resolveTools(toolset?: ToolsetId) {
    const toolsetRegistry: Record<string, () => Promise<any[]>> = {
      widgets: async () => {
        const [w, we, vo, wp, va, dr, fu, sm, gc, svg, rc] = await Promise.all([widgetsTools(), weatherTools(), vocabularyTools(), webpageTools(), vrmAnimationTools(), drawImageTools(), fetchUrlTools(), storeMemoryTools(), gameControlTools(), drawSvgTools(), rocoBattleTools()])
        return [...w, ...we, ...vo, ...wp, ...va, ...dr, ...fu, ...sm, ...gc, ...svg, ...rc]
      },
      artistry: async () => {
        const [ai, wi, we, vo, wp, va, dr, fu, sm, gc, svg] = await Promise.all([
          imageJournalTools(),
          widgetsTools(),
          weatherTools(),
          vocabularyTools(),
          webpageTools(),
          vrmAnimationTools(),
          drawImageTools(),
          fetchUrlTools(),
          storeMemoryTools(),
          gameControlTools(),
          drawSvgTools(),
        ])
        return [...ai, ...wi, ...we, ...vo, ...wp, ...va, ...dr, ...fu, ...sm, ...gc, ...svg]
      },
    }

    if (toolset && toolsetRegistry[toolset]) {
      return toolsetRegistry[toolset]
    }

    return undefined
  }

  function readNewAssistantVisibleText(sessionId: string, fromIndex: number): string {
    const assistant = chatSession.getSessionMessages(sessionId)
      .slice(fromIndex)
      .reverse()
      .find(message => message.role === 'assistant')
    return assistant ? extractMessageText(assistant) : ''
  }

  // Deterministic dance trigger. AIRI's persona-heavy system prompt makes the LLM
  // narrate actions ("*starts dancing*") instead of calling vrm_play_animation, so when
  // the user clearly asks to dance we fire the gesture ourselves — the LLM still replies
  // in character. Matches against the auto-discovered dance names (filenames under
  // assets/vrm/animations/dances/, see vrmGestureAnimations).

  // Prefixes that VRChat batch conversion prepends to filenames. Stripping them lets
  // users say e.g. "跳美少女无罪" even if the file is still named with the full prefix.
  const DANCE_NAME_PREFIXES = [
    'tiktok_motion_tiktok_',
    'tiktok_motion_',
    'animation_base_lazuli_',
    'animation_lazuli_lazuli_',
    'animation_lazuli_',
  ]
  const ANIMATION_TIKTOK_NUM_RE = /^animation_tiktok_\d+_/

  function normalizeDanceName(name: string): string {
    for (const prefix of DANCE_NAME_PREFIXES) {
      if (name.startsWith(prefix))
        return name.slice(prefix.length)
    }
    return name.replace(ANIMATION_TIKTOK_NUM_RE, '')
  }

  function maybeTriggerDance(text: string): void {
    if (!text)
      return
    const store = useModelStore()
    if (!store.vrmModelLoaded)
      return
    const names = Object.keys(vrmGestureAnimations)
    if (!names.length)
      return
    const lower = text.toLowerCase()
    // Fuzzy matching: find the dance name that best matches the user's input.
    // Strategy:
    // 1. Direct containment (user says "进化论" → matches "进化论")
    // 2. Shared substrings (user says "进化轮" → shares "进化" with "进化论")
    // 3. Prefix match (user says "进化" → matches "进化论")
    //
    // Score each candidate by longest shared substring length, pick the best.
    let bestMatch: string | undefined
    let bestScore = 0

    for (const name of names) {
      const stripped = normalizeDanceName(name)
      const candidates = [stripped, name]

      for (const candidate of candidates) {
        // Direct containment
        if (lower.includes(candidate) || candidate.includes(lower)) {
          const score = candidate.length
          if (score > bestScore) { bestScore = score; bestMatch = name }
          continue
        }

        // Shared substring: find longest common substring >= 2 chars
        for (let ci = 0; ci < candidate.length - 1; ci++) {
          for (let cj = ci + 2; cj <= candidate.length; cj++) {
            const sub = candidate.slice(ci, cj)
            if (lower.includes(sub) && sub.length > bestScore) {
              bestScore = sub.length
              bestMatch = name
            }
          }
        }

        // Prefix match (e.g. "进化" → "进化论")
        for (let plen = 2; plen <= candidate.length; plen++) {
          const prefix = candidate.slice(0, plen)
          if (lower.endsWith(prefix) || lower.includes(prefix)) {
            if (plen > bestScore) { bestScore = plen; bestMatch = name }
          }
        }
      }
    }

    const named = bestScore >= 2 ? bestMatch : undefined
    // "跳" + generic dance keyword triggers a random dance
    const wantsDance = text.includes('跳') && /舞|dance/i.test(text)
    if (!named && !wantsDance)
      return

    if (named) {
      // Check for numbered variants: if user says "质问恋爱", find all
      // "质问恋爱1", "质问恋爱2", "质问恋爱3" and play them in sequence.
      const base = named.replace(/\d+$/, '') // strip trailing number
      const variants = names
        .filter(n => n !== named && n.startsWith(base) && /\d+$/.test(n))
        .sort((a, b) => (Number.parseInt(a.match(/(\d+)$/)?.[1] || '0')) - (Number.parseInt(b.match(/(\d+)$/)?.[1] || '0')))

      const queue = [vrmGestureAnimations[named]]
      for (const v of variants) {
        const u = vrmGestureAnimations[v]
        if (u)
          queue.push(u)
      }

      // Play first, chain the rest with delays
      store.requestGesturePlay(queue[0], {})
      for (let i = 1; i < queue.length; i++) {
        setTimeout(() => {
          if (store.vrmModelLoaded)
            store.requestGesturePlay(queue[i], {})
        }, i * 12000) // ~12s per dance (typical vrma duration + cross-fade)
      }
    }
    else {
      const pick = names[Math.floor(Math.random() * names.length)]
      const url = vrmGestureAnimations[pick]
      if (url)
        store.requestGesturePlay(url, {})
    }
  }

  /**
   * Manual screen-look trigger. When the user says "看看" / "look" / "看屏幕",
   * increment the vision store's manualLookRequest counter so the screen-watch
   * composable fires one capture+comment cycle immediately, bypassing interval
   * and throttle gates.
   *
   * In eco mode this is the primary way to get the pet to look at the screen.
   * In active mode it's a bonus — lets the user force a comment right now.
   */
  /** Returns true if the message triggered a manual screen look. */
  function matchesLook(text: string): boolean {
    return /看看|看屏幕|看一眼|看桌面|桌面.*看|看.*桌面|屏幕.*看|看.*屏幕|look|watch|瞅瞅|瞧瞧/i.test(text)
  }

  /**
   * Direct screen capture + VLM inference for manual "look" requests.
   * Uses desktopCapturer IPC — no system permission dialog needed.
   * Returns the VLM description text, or empty string on failure.
   */
  async function captureAndDescribeScreen(): Promise<string> {
    try {
      // Step 1: capture screen via desktopCapturer IPC
      const capResult = await (window as any).electron.ipcRenderer.invoke('screen-capture:capture')
      const rawDataUrl = capResult?.dataUrl
      if (!rawDataUrl) {
        return `截图失败：IPC 返回空数据`
      }

      // Step 2: mask the pet's own window so the VLM doesn't see itself
      let dataUrl = rawDataUrl
      try {
        const bounds = await (window as any).electron.ipcRenderer.invoke('get-pet-window-bounds')
        if (bounds && bounds.width > 0 && bounds.height > 0) {
          dataUrl = await applyMaskToDataUrl(rawDataUrl, bounds)
        }
      }
      catch { /* mask is nice-to-have */ }

      // Step 3: VLM inference
      const visionOrchestrator = useVisionOrchestratorStore()
      const vlmResult = await visionOrchestrator.processCapture({
        imageDataUrl: dataUrl,
        workloadId: 'screen:chat-look' as any,
        sourceId: 'chat-look',
        capturedAt: Date.now(),
        publishContext: false,
      })
      return vlmResult.text || '视觉模型返回空文本'
    }
    catch (e: any) {
      return `截图分析异常：${e?.message || String(e)}`
    }
  }

  /** Apply a dark mask rectangle to an image data URL. */
  function applyMaskToDataUrl(dataUrl: string, bounds: { x: number, y: number, width: number, height: number }): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0)
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

  /** Switch vision mode via chat ("切换耗能模式" / "切换节能模式"). */
  /** Language toggle: "切换日语" / "切换中文". */
  function maybeToggleLanguage(text: string): void {
    const visionStore = useVisionStore()
    if (/切换日语|日语模式|说日语|日本語/i.test(text) && !/切换中文|中文模式|说中文/i.test(text)) {
      visionStore.toggleJapanese()
    }
    else if (/切换中文|中文模式|说中文/i.test(text) && !/切换日语|日语模式|说日语|日本語/i.test(text)) {
      if (visionStore.japaneseMode) visionStore.toggleJapanese()
    }
  }

  /** Teaching mode: "开始教学" / "结束教学". */
  function maybeTriggerTeaching(text: string): string {
    if (/开始教学|教学模式|teach.*mode/i.test(text) && !/结束|停止/i.test(text)) {
      void (window as any).electron.ipcRenderer.invoke('game-teaching:start', { title: '洛克王国教程' })
      return '教学模式已开启。你按键就是在教她。'
    }
    if (/结束教学|停止教学|end.*teach/i.test(text)) {
      void (window as any).electron.ipcRenderer.invoke('game-teaching:stop')
      return '教学模式已结束。'
    }
    return ''
  }

  /** Toggle art-studio mode: "一起画画" / "画画模式" / "停止画画". */
  function maybeTriggerArtMode(text: string): string {
    const visionStore = useVisionStore()
    if (/一起画画|画画模式|画室模式|art.*mode|看.*画画/i.test(text) && !/停止|结束|关闭/i.test(text)) {
      visionStore.setGameWatch(true)
      visionStore.artMode = true
      return '画画模式已开启。我会看着你的画布，给你反馈～'
    }
    return ''
  }

  /** Toggle game-watch: "开始游戏监控" / "停止游戏监控". */
  function maybeTriggerGameWatch(text: string): string {
    const visionStore = useVisionStore()
    if (/开始游戏|游戏监控|游戏模式|watch.*game/i.test(text) && !/停止|结束|关闭/i.test(text)) {
      visionStore.setGameWatch(true)
      return '游戏监控已开启'
    }
    if (/停止游戏|结束游戏|关闭游戏|stop.*game/i.test(text)) {
      visionStore.setGameWatch(false)
      return '游戏监控已停止'
    }
    return ''
  }

  function maybeSwitchVisionMode(text: string): void {
    const visionStore = useVisionStore()
    if (/切换.*(?:耗能|active|高频|游戏)/i.test(text)) {
      visionStore.setVisionMode('active')
    }
    else if (/切换.*(?:节能|eco|省电|低频|工作|画画)/i.test(text)) {
      visionStore.setVisionMode('eco')
    }
  }

  /**
   * "读单词" / "读英语" — capture screen, OCR English text via Gemini Vision,
   * and read it aloud via TTS. Increments the vision store's englishReadRequest
   * counter; the screen-watch composable watches it and fires a capture+OCR+speak.
   */
  function maybeTriggerReadWords(text: string): void {
    if (!/读单词|读英语|念单词|read\s*words/i.test(text))
      return
    const visionStore = useVisionStore()
    visionStore.englishReadRequest += 1
  }

  /**
   * Hand prop switching via chat keywords.
   * - "拿相机" / "拍照" → camera in both hands
   * - "拿笔" / "握笔" → pencil in right hand
   * - "拿数位板" / "画画" / "画图" → tablet left + pen right
   * - "放下" / "收起来" / "不拿了" → remove all props
   */
  function maybeTriggerProp(text: string): void {
    const store = useModelStore()
    if (/拿相机|拍照|照相|camera/i.test(text)) {
      store.requestHandProp('camera')
    }
    else if (/拿数位板|拿平板|tablet/i.test(text)) {
      store.requestHandProp('tablet-pen')
    }
    else if (/拿笔|握笔|铅笔|pencil/i.test(text)) {
      store.requestHandProp('pencil')
    }
    else if (/放下|收起来|不拿了|拿掉|remove.*prop/i.test(text)) {
      store.requestHandProp('none')
      // Also hide workstation when putting props away
      if (store.workstationVisible)
        store.requestWorkstation(false)
    }
  }

  /**
   * Drawing workstation trigger: desk + screen + pencil + look-down gaze.
   * - "画画工作台" / "开始画画" → show workstation + pencil
   * - "收起工作台" / "停止画画" → hide workstation + pencil
   */
  function maybeTriggerWorkstation(text: string): void {
    const store = useModelStore()
    if (/画画工作台|开始画画|打开工作台/.test(text)) {
      store.requestWorkstation(true)
      store.requestHandProp('pencil')
    }
    else if (/收起工作台|关闭工作台|停止画画/.test(text)) {
      store.requestWorkstation(false)
      store.requestHandProp('none')
    }
  }

  /**
   * Memory system chat keywords.
   *
   * - "忘掉..." / "forget..." → delete memories by keyword query
   * - "不要记住刚才的内容" → skip last turn from working memory
   * - "你记得我什么" / "你记得什么" → inject active memories as context for LLM
   * - "删除关于当前项目的记忆" → forget by project
   * - "导出我的记忆" → trigger export (handled in settings page)
   * - "暂停长期记忆" / "恢复长期记忆" → toggle long-term memory setting
   *
   * Returns a string to inject as extra system prompt context (for memory list),
   * or empty string if no context injection needed.
   */
  function maybeTriggerMemory(text: string): string {
    const memoryStore = useMemoryStore()
    const workingMemory = useWorkingMemoryStore()

    // "不要记住刚才的内容" — skip last turn
    if (/不要记住刚才|forget what I just said|don't remember that/i.test(text)) {
      workingMemory.skipLastTurn()
      return ''
    }

    // "这个只在今天有效" — mark as temporary
    if (/这个只在今天有效|this is only for today|only valid today/i.test(text)) {
      // NOTICE: This is a hint stored in working memory; the extraction
      // pipeline uses it to set temporary TTL when saving.
      // The actual TTL is set by MemoryExtractor.evaluateForMemory based on the keyword context.
      return ''
    }

    // "忘掉..." / "forget..." — delete by query
    const forgetMatch = text.match(/(?:忘掉|忘了|忘记|forget|delete.*memory)\s*(?:关于|about\s+)?(.+)/i)
    if (forgetMatch) {
      const query = forgetMatch[1]?.trim()
      if (query && memoryStore.enabled) {
        memoryStore.forget('default-user', query).catch(e =>
          console.error('[chat-sync] Failed to forget memories:', e),
        )
      }
      // Still let the message go to LLM so it can acknowledge
      return ''
    }

    // "删除关于当前项目的记忆" — forget by project
    if (/删除关于.*项目.*记忆|忘记.*项目.*记忆|forget.*project/i.test(text)) {
      const currentProject = workingMemory.currentProject
      if (currentProject && memoryStore.enabled) {
        memoryStore.forget('default-user', '', currentProject).catch(e =>
          console.error('[chat-sync] Failed to forget project memories:', e),
        )
      }
      return ''
    }

    return ''
  }

  async function executeIngest(payload: IngestCommandPayload): Promise<void> {
    // Fire a dance directly on intent, independent of whether the LLM calls the tool.
    maybeTriggerDance(payload.text)
    // Manual screen-look trigger — "看看" fires a forced capture+comment.
    // If the user asked to look, wait for the VLM result before calling the LLM
    // so the consciousness model can reference what it saw on screen.
    // Manual screen look: if user says "看看", capture screen and run VLM
    // directly in the ingest pipeline (no watchers, no races).
    const lookTriggered = matchesLook(payload.text)
    if (lookTriggered) {
      // Fire-and-forget: start capture immediately, will await below
    }
    // Vision mode switch.
    maybeSwitchVisionMode(payload.text)
    // Game watch toggle — "开始游戏监控" / "停止游戏监控".
    void maybeTriggerGameWatch(payload.text)
    // Art studio mode — "一起画画".
    void maybeTriggerArtMode(payload.text)
    // Teaching mode — "开始教学" / "结束教学".
    void maybeTriggerTeaching(payload.text)
    // Language toggle — "切换日语" / "切换中文".
    void maybeToggleLanguage(payload.text)
    // "读单词" — read recent English words from vocab DB via TTS.
    void maybeTriggerReadWords(payload.text)
    // Hand prop switching — "拿相机" / "拿笔" / "拿数位板" / "放下".
    maybeTriggerProp(payload.text)
    // Drawing workstation — "画画工作台" desk + screen + pencil.
    maybeTriggerWorkstation(payload.text)
    // Memory system keywords — forget, skip, toggle settings.
    void maybeTriggerMemory(payload.text)

    const providerId = activeProvider.value
    const modelId = activeModel.value
    if (!providerId || !modelId) {
      throw new Error('No active chat provider or model configured')
    }

    const chatProvider = await providersStore.getProviderInstance<ChatProvider>(providerId)
    if (!chatProvider) {
      throw new Error(`Failed to resolve chat provider "${providerId}"`)
    }

    // If the user said "看看", capture screen and directly insert the
    // VLM observation as an assistant message in chat. The user sees the
    // observation immediately; the LLM can then naturally respond to it.
    if (lookTriggered) {
      const obs = await captureAndDescribeScreen()
      if (obs) {
        const sessionId = payload.sessionId || activeSessionId.value
        const msgs = chatSession.getSessionMessages(sessionId)
        // Insert the observation as an assistant message BEFORE the
        // pending user message. The LLM sees this as conversation context
        // and the chat UI renders it as a normal message.
        chatSession.setSessionMessages(sessionId, [
          ...msgs,
          {
            role: 'assistant' as const,
            content: obs,
            id: `vision-look-${Date.now()}`,
            createdAt: Date.now(),
            slices: [{ type: 'text' as const, text: obs }],
            tool_results: [],
          },
        ])
      }
    }

    // Language mode: if Japanese is ON, force Japanese output.
    const visionStore = useVisionStore()
    const finalText = visionStore.japaneseMode
      ? `[IMPORTANT: ALL output MUST be in Japanese (日本語のみ). No Chinese.]\n\n${payload.text}`
      : payload.text

    await chatOrchestrator.ingest(finalText, {
      model: modelId,
      chatProvider,
      attachments: payload.attachments,
      input: payload.input,
      tools: resolveTools(payload.toolset),
    }, payload.sessionId)
  }

  async function executeSpotlightIngest(payload: SpotlightIngestPayload): Promise<SpotlightIngestResult> {
    // NOTICE: `chatOrchestrator.ingest()` returns void; remove this snapshot
    // read once ingest returns `{ sessionId, visibleText }`.
    const sessionId = activeSessionId.value
    const previousMessageCount = chatSession.getSessionMessages(sessionId).length

    await executeIngest({
      text: payload.text,
      toolset: 'artistry',
      sessionId,
    })

    const visibleText = readNewAssistantVisibleText(sessionId, previousMessageCount)
    if (!visibleText.trim())
      throw new Error('Spotlight returned an empty response')

    return {
      sessionId,
      visibleText,
    }
  }

  async function executeRetry(payload: RetryCommandPayload) {
    const sessionId = payload.sessionId || activeSessionId.value
    const currentMessages = chatSession.getSessionMessages(sessionId)
    const sourceIndex = resolveRetrySourceIndex(currentMessages, payload.index)
    if (sourceIndex < 0)
      throw new Error('Retry target has no retriable source message')

    const text = getRetryText(currentMessages[sourceIndex])
    if (!text)
      throw new Error('Retry target has no retriable user message')

    const nextMessages = currentMessages.slice(0, sourceIndex)
    chatSession.setSessionMessages(sessionId, nextMessages)

    await executeIngest({
      text,
      sessionId,
      toolset: 'widgets',
    })
  }

  async function executeToolCallRerunCommand(payload: ToolCallRerunPayload<ToolsetId>) {
    const sessionId = payload.sessionId || activeSessionId.value
    const nextMessages = await executeToolCallRerun({
      messages: chatSession.getSessionMessages(sessionId),
      payload,
      resolveTools: () => resolveLlmTools({ customTools: resolveTools(payload.toolset) }),
    })
    chatSession.setSessionMessages(sessionId, nextMessages)
  }

  function executeDeleteMessage(payload: { sessionId?: string, messageId?: string, index?: number }) {
    const sessionId = payload.sessionId || activeSessionId.value
    const nextMessages = chatSession.getSessionMessages(sessionId).filter((message, index) => {
      if (payload.messageId)
        return message.id !== payload.messageId
      if (payload.index !== undefined)
        return index !== payload.index
      return true
    })

    chatSession.setSessionMessages(sessionId, nextMessages)
  }

  function appendIngestErrorMessage(payload: IngestCommandPayload, message: string) {
    const sessionId = payload.sessionId || activeSessionId.value
    const nextMessages = [
      ...chatSession.getSessionMessages(sessionId),
      {
        role: 'error',
        content: message,
      } satisfies ChatHistoryItem,
    ]
    chatSession.setSessionMessages(sessionId, nextMessages)
  }

  function authorityCommandMeta(message: { requestId: string, senderId: string, command: string, payload: unknown }) {
    return {
      mode: mode.value,
      authorityId: authorityId.value,
      requestId: message.requestId,
      senderId: message.senderId,
      command: message.command,
      payload: previewChatSyncPayload(message.payload),
    }
  }

  async function handleCommand(message: Extract<ChatSyncMessage, { type: 'command' }>) {
    if (mode.value !== 'authority')
      return

    const respond = (response: ChatResponsePayload) => {
      post({
        type: 'response',
        requestId: message.requestId,
        authorityId: instanceId,
        ...response,
      })
    }

    try {
      switch (message.command) {
        case 'ingest':
          await executeIngest(message.payload)
          break
        case 'spotlight-ingest':
          respond({ ok: true, result: await executeSpotlightIngest(message.payload) })
          return
        case 'retry':
          await executeRetry(message.payload)
          break
        case 'tool-call-rerun':
          await executeToolCallRerunCommand(message.payload)
          break
        case 'cleanup':
          cleanupMessages(message.payload.sessionId)
          break
        case 'delete-message':
          executeDeleteMessage(message.payload)
          break
      }

      respond({ ok: true })
    }
    catch (error) {
      const errorMessage = errorMessageFrom(error) ?? 'Unknown chat sync command failure'

      logChatSyncError('command failed', error, authorityCommandMeta(message))

      if (message.command === 'ingest') {
        appendIngestErrorMessage(message.payload, errorMessage)
      }
      else if (message.command === 'spotlight-ingest') {
        appendIngestErrorMessage({
          text: message.payload.text,
          toolset: 'artistry',
          sessionId: activeSessionId.value,
        }, errorMessage)
      }

      respond({ ok: false, error: errorMessage })
    }
  }

  function takePendingRequest(requestId: string): PendingRequest | undefined {
    const pending = pendingRequests.get(requestId)
    if (!pending)
      return undefined

    clearTimeout(pending.timeout)
    pendingRequests.delete(requestId)
    return pending
  }

  function settleResponse(message: Extract<ChatSyncMessage, { type: 'response' }>) {
    const pending = takePendingRequest(message.requestId)
    if (!pending)
      return

    if (message.ok) {
      pending.resolve('result' in message ? message.result : undefined)
      return
    }

    pending.reject(new Error(message.error ?? 'Remote chat command failed'))
  }

  function handleMessage(event: MessageEvent<ChatSyncMessage>) {
    const message = event.data
    if (!message)
      return

    switch (message.type) {
      case 'authority-announcement':
        authorityId.value = message.authorityId
        if (mode.value === 'follower')
          post({ type: 'request-snapshot', requestId: createRequestId(), senderId: instanceId })
        return
      case 'request-snapshot':
        if (mode.value === 'authority')
          broadcastSessionSnapshot()
        return
      case 'session-snapshot':
        if (mode.value !== 'follower')
          return
        authorityId.value = message.authorityId
        applySessionSnapshot(message.snapshot)
        return
      case 'stream-snapshot':
        if (mode.value !== 'follower')
          return
        authorityId.value = message.authorityId
        applyStreamSnapshot(message.snapshot)
        return
      case 'command':
        void handleCommand(message)
        return
      case 'response':
        settleResponse(message)
    }
  }

  function attachChannel() {
    if (channel)
      return

    channel = new BroadcastChannel(CHAT_SYNC_CHANNEL_NAME)
    channel.addEventListener('message', handleMessage as EventListener)
  }

  function detachChannel() {
    if (!channel)
      return

    channel.removeEventListener('message', handleMessage as EventListener)
    channel.close()
    channel = null
  }

  function resetPendingRequests() {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Chat sync channel disposed'))
    }
    pendingRequests.clear()
  }

  function initialize(nextMode: Exclude<ChatSyncMode, 'inactive'>) {
    if (mode.value === nextMode && channel)
      return

    dispose()
    attachChannel()
    mode.value = nextMode
    authorityId.value = nextMode === 'authority' ? instanceId : authorityId.value

    if (nextMode === 'authority') {
      registerAuthorityWatchers()
      broadcastSessionSnapshot()
      broadcastStreamSnapshot()
      return
    }

    post({ type: 'request-snapshot', requestId: createRequestId(), senderId: instanceId })
  }

  function dispatch<T>(
    message: Extract<ChatSyncMessage, { type: 'command' }>,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
    timeoutError: () => Error = () => new Error('Timed out waiting for chat authority response'),
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(message.requestId)
        const error = timeoutError()
        logChatSyncError('command timed out waiting for authority response', error, authorityCommandMeta(message))
        reject(error)
      }, timeoutMs)

      pendingRequests.set(message.requestId, {
        resolve: result => resolve(result as T),
        reject,
        timeout,
      })
      post(message)
    })
  }

  async function requestIngest(payload: IngestCommandPayload) {
    if (mode.value === 'authority') {
      await executeIngest(payload)
      return
    }

    return await dispatch<void>({
      type: 'command',
      requestId: createRequestId(),
      senderId: instanceId,
      command: 'ingest',
      payload,
    })
  }

  async function requestSpotlightIngest(payload: SpotlightIngestPayload) {
    if (mode.value === 'authority')
      return executeSpotlightIngest(payload)

    return dispatch<SpotlightIngestResult>({
      type: 'command',
      requestId: createRequestId(),
      senderId: instanceId,
      command: 'spotlight-ingest',
      payload,
    }, SPOTLIGHT_REQUEST_TIMEOUT_MS, () => new Error('Spotlight response timed out'))
  }

  async function requestRetry(payload: RetryCommandPayload) {
    if (mode.value === 'authority') {
      await executeRetry(payload)
      return
    }

    return await dispatch<void>({
      type: 'command',
      requestId: createRequestId(),
      senderId: instanceId,
      command: 'retry',
      payload,
    })
  }

  async function requestToolCallRerun(payload: ToolCallRerunPayload<ToolsetId>) {
    if (mode.value === 'authority') {
      await executeToolCallRerunCommand(payload)
      return
    }

    return await dispatch<void>({
      type: 'command',
      requestId: createRequestId(),
      senderId: instanceId,
      command: 'tool-call-rerun',
      payload,
    })
  }

  async function requestCleanup(sessionId?: string) {
    if (mode.value === 'authority') {
      cleanupMessages(sessionId)
      return
    }

    return await dispatch<void>({
      type: 'command',
      requestId: createRequestId(),
      senderId: instanceId,
      command: 'cleanup',
      payload: { sessionId },
    })
  }

  async function requestDeleteMessage(payload: { sessionId?: string, messageId?: string, index?: number }) {
    if (mode.value === 'authority') {
      executeDeleteMessage(payload)
      return
    }

    return await dispatch<void>({
      type: 'command',
      requestId: createRequestId(),
      senderId: instanceId,
      command: 'delete-message',
      payload,
    })
  }

  function dispose() {
    stopWatchers()
    clearHeartbeat()
    resetPendingRequests()
    detachChannel()
    mode.value = 'inactive'
    authorityId.value = null
  }

  return {
    authorityId,
    mode,
    initialize,
    dispose,
    requestIngest,
    requestSpotlightIngest,
    requestRetry,
    requestToolCallRerun,
    requestCleanup,
    requestDeleteMessage,
  }
})
