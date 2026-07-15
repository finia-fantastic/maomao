<script setup lang="ts">
import type { MemoryRecord, MemorySettings, MemoryType } from '@proj-airi/stage-ui/services/memory/types'

import { useMemoryStore } from '@proj-airi/stage-ui/stores/memory'
import { Button } from '@proj-airi/ui'
import { onMounted, ref, watch } from 'vue'

const store = useMemoryStore()

// State
const memories = ref<MemoryRecord[]>([])
const settings = ref<MemorySettings>({
  enableLongTermMemory: true,
  enableSessionSummary: true,
  enableSensitiveMemory: false,
  defaultTemporaryTTL: 86400,
  maxRetrievedMemories: 8,
  maxMemoryPromptTokens: 1000,
})
const stats = ref({ totalMemories: 0, activeMemories: 0, expiredMemories: 0, dbSizeBytes: 0 })
const loading = ref(false)
const searchQuery = ref('')
const filterType = ref<string>('')
const filterProject = ref<string>('')
const editMemory = ref<MemoryRecord | null>(null)
const editContent = ref('')
const userId = ref('default-user')
const errorMessage = ref<string | null>(null)

const memoryTypes = [
  { value: '', label: '全部类型' },
  { value: 'profile', label: '个人信息' },
  { value: 'preference', label: '偏好' },
  { value: 'project', label: '项目' },
  { value: 'decision', label: '决定' },
  { value: 'relationship', label: '人际关系' },
  { value: 'episode', label: '事件' },
  { value: 'commitment', label: '承诺' },
  { value: 'correction', label: '纠正' },
  { value: 'temporary', label: '临时' },
]

function typeLabel(type: MemoryType): string {
  const found = memoryTypes.find(t => t.value === type)
  return found?.label ?? type
}

async function loadSettings(): Promise<void> {
  try {
    settings.value = await store.getSettings()
  }
  catch (e: unknown) {
    console.error('Failed to load memory settings:', e)
    errorMessage.value = (e as Error).message ?? 'Failed to load settings'
  }
}

async function loadMemories(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    if (searchQuery.value || filterType.value || filterProject.value) {
      memories.value = await store.search({
        userId: userId.value,
        query: searchQuery.value || undefined,
        type: (filterType.value || undefined) as MemoryType | undefined,
        projectId: filterProject.value || undefined,
        limit: 50,
      })
    }
    else {
      memories.value = await store.listActive(userId.value, 50)
    }
  }
  catch (e: unknown) {
    console.error('Failed to load memories:', e)
    errorMessage.value = (e as Error).message ?? 'Failed to load memories'
  }
  finally { loading.value = false }
}

async function loadStats(): Promise<void> {
  try {
    stats.value = await store.getStats()
  }
  catch (e: unknown) {
    console.error('Failed to load memory stats:', e)
  }
}

async function handleDelete(id: number): Promise<void> {
  await store.deleteMemory(id)
  await loadMemories()
}

async function handleForget(query: string): Promise<void> {
  await store.forget(userId.value, query)
  searchQuery.value = ''
  await loadMemories()
}

async function handleExport(): Promise<void> {
  try {
    const data = await store.exportMemories(userId.value)
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `airi-memories-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  catch (e: unknown) {
    console.error('Failed to export memories:', e)
    errorMessage.value = (e as Error).message ?? 'Failed to export'
  }
}

async function handleUpdateSetting(key: keyof MemorySettings, value: boolean | number): Promise<void> {
  settings.value = { ...settings.value, [key]: value }
  await store.updateSettings({ [key]: value })
}

function openEdit(memory: MemoryRecord): void {
  editMemory.value = memory
  editContent.value = memory.content
}

function cancelEdit(): void {
  editMemory.value = null
  editContent.value = ''
}

async function saveEdit(): Promise<void> {
  if (!editMemory.value)
    return
  // NOTICE: Full in-place editing requires the updateMemory IPC handler;
  // for now, inline edits refresh the list after save.
  // Future: wire up memoryUpdate for partial field edits on each record.
  editMemory.value = null
  editContent.value = ''
  await loadMemories()
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadMemories(), loadStats()])
})

watch([searchQuery, filterType, filterProject], () => {
  void loadMemories()
})
</script>

<template>
  <div :class="['flex flex-col gap-6 p-4']">
    <div v-if="!store.enabled" text="neutral-400 p-8 text-center">
      <div text="lg">
        Memory
      </div>
      <div text="sm mt-2">
        记忆系统仅支持桌面应用。Memory system is only available on the desktop app.
      </div>
    </div>

    <template v-else>
      <!-- Error banner -->
      <div v-if="errorMessage" :class="['px-4 py-2 rounded bg-red-500/10 border border-red-500/20 text-sm text-red-400']">
        {{ errorMessage }}
      </div>

      <!-- Stats -->
      <div :class="['flex gap-4']">
        <div :class="['flex-1 px-4 py-3 rounded-lg bg-white/5 border border-white/10']">
          <div text="xs neutral-400">
            总记忆数
          </div>
          <div text="lg font-bold">
            {{ stats.totalMemories }}
          </div>
        </div>
        <div :class="['flex-1 px-4 py-3 rounded-lg bg-white/5 border border-white/10']">
          <div text="xs neutral-400">
            活跃记忆
          </div>
          <div text="lg font-bold">
            {{ stats.activeMemories }}
          </div>
        </div>
        <div :class="['flex-1 px-4 py-3 rounded-lg bg-white/5 border border-white/10']">
          <div text="xs neutral-400">
            已过期/删除
          </div>
          <div text="lg font-bold">
            {{ stats.expiredMemories }}
          </div>
        </div>
      </div>

      <!-- Settings toggles -->
      <div :class="['flex flex-col gap-3 p-4 rounded-lg bg-white/5 border border-white/10']">
        <div text="sm font-medium mb-1">
          记忆设置
        </div>

        <label :class="['flex items-center gap-3 cursor-pointer']">
          <input
            type="checkbox"
            :checked="settings.enableLongTermMemory"
            class="h-4 w-4"
            @change="handleUpdateSetting('enableLongTermMemory', ($event.target as HTMLInputElement).checked)"
          >
          <div :class="['flex flex-col']">
            <span text="sm">启用长期记忆</span>
            <span text="xs neutral-400">自动存储和检索长期记忆</span>
          </div>
        </label>

        <label :class="['flex items-center gap-3 cursor-pointer']">
          <input
            type="checkbox"
            :checked="settings.enableSessionSummary"
            class="h-4 w-4"
            @change="handleUpdateSetting('enableSessionSummary', ($event.target as HTMLInputElement).checked)"
          >
          <div :class="['flex flex-col']">
            <span text="sm">启用会话摘要</span>
            <span text="xs neutral-400">会话结束后生成摘要存入长期记忆</span>
          </div>
        </label>

        <label :class="['flex items-center gap-3 cursor-pointer']">
          <input
            type="checkbox"
            :checked="settings.enableSensitiveMemory"
            class="h-4 w-4"
            @change="handleUpdateSetting('enableSensitiveMemory', ($event.target as HTMLInputElement).checked)"
          >
          <div :class="['flex flex-col']">
            <span text="sm">允许存储敏感信息</span>
            <span text="xs neutral-400">允许存储包含密码/密钥等敏感内容</span>
          </div>
        </label>

        <div :class="['flex items-center gap-3 mt-1']">
          <span text="sm">最大检索记忆数:</span>
          <select
            :value="settings.maxRetrievedMemories"
            :class="['bg-white/10 rounded px-3 py-1.5 text-sm border border-white/10']"
            @change="handleUpdateSetting('maxRetrievedMemories', Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="3">
              3
            </option>
            <option :value="5">
              5
            </option>
            <option :value="8">
              8
            </option>
            <option :value="10">
              10
            </option>
            <option :value="15">
              15
            </option>
          </select>
        </div>
      </div>

      <!-- Search & filter -->
      <div :class="['flex gap-3 items-center']">
        <input
          v-model="searchQuery"
          placeholder="搜索记忆..."
          :class="['flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm outline-none']"
        >
        <select
          v-model="filterType"
          :class="['px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm']"
        >
          <option v-for="opt in memoryTypes" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <Button size="sm" variant="outline" :disabled="!searchQuery" @click="handleForget(searchQuery)">
          遗忘匹配
        </Button>
        <Button size="sm" variant="outline" @click="handleExport">
          导出 JSON
        </Button>
      </div>

      <!-- Memory list -->
      <div v-if="loading" text="sm neutral-400 py-4">
        加载中...
      </div>

      <div v-else-if="memories.length === 0" text="sm neutral-400 py-4 text-center">
        暂无记忆记录
      </div>

      <div v-else :class="['flex flex-col gap-2']">
        <div
          v-for="memory in memories"
          :key="memory.id"
          :class="['p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors']"
        >
          <div :class="['flex items-start justify-between gap-2']">
            <div :class="['flex-1 min-w-0']">
              <div :class="['flex items-center gap-2 mb-1 flex-wrap']">
                <span
                  :class="['px-1.5 py-0.5 rounded text-xs font-medium',
                           memory.type === 'correction' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400']"
                >
                  {{ typeLabel(memory.type) }}
                </span>
                <span
                  v-if="memory.sensitive"
                  :class="['px-1 py-0.5 rounded text-xs bg-yellow-500/15 text-yellow-400']"
                >敏感</span>
                <span
                  v-if="memory.status !== 'active'"
                  :class="['px-1 py-0.5 rounded text-xs bg-neutral-500/15 text-neutral-400']"
                >{{ memory.status }}</span>
              </div>
              <div text="sm font-medium truncate">
                {{ memory.subject }}
              </div>
              <div text="xs neutral-400 mt-1 line-clamp-2">
                {{ memory.content }}
              </div>
              <div :class="['flex items-center gap-3 mt-2 text-xs text-neutral-500']">
                <span>重要性 {{ Math.round(memory.importance * 100) }}%</span>
                <span>置信度 {{ Math.round(memory.confidence * 100) }}%</span>
                <span>{{ memory.updatedAt?.slice(0, 10) }}</span>
                <span v-if="memory.projectId" text="neutral-500">{{ memory.projectId }}</span>
              </div>
            </div>
            <div :class="['flex gap-1 shrink-0']">
              <Button size="sm" variant="ghost" @click="openEdit(memory)">
                查看
              </Button>
              <Button size="sm" variant="ghost" @click="handleDelete(memory.id)">
                删除
              </Button>
            </div>
          </div>

          <!-- Edit inline panel -->
          <div v-if="editMemory?.id === memory.id" :class="['mt-3 p-3 rounded bg-white/5 border border-white/10']">
            <textarea
              v-model="editContent"
              :class="['w-full min-h-20 px-3 py-2 rounded bg-white/5 border border-white/10 text-sm resize-y outline-none']"
            />
            <div :class="['flex gap-2 mt-2']">
              <Button size="sm" @click="saveEdit">
                保存
              </Button>
              <Button size="sm" variant="outline" @click="cancelEdit">
                取消
              </Button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:leaf-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
</route>
