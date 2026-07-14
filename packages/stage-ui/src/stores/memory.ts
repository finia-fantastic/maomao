import type { MemoryRecord, MemorySettings, MemoryType } from '../services/memory/types'

import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * IPC provider interface for memory operations.
 *
 * Initialized by the Electron renderer using `useElectronEventaInvoke`.
 * On web (non-Electron), this remains null and memory features are disabled.
 */
export interface MemoryIPCProvider {
  search: (payload: {
    userId: string
    query?: string
    projectId?: string | null
    type?: MemoryType
    limit?: number
    offset?: number
  }) => Promise<MemoryRecord[]>

  listActive: (payload: { userId: string, limit?: number }) => Promise<MemoryRecord[]>

  delete: (payload: { id: number }) => Promise<void>

  forget: (payload: { userId: string, query: string, projectId?: string | null }) => Promise<{ deletedCount: number }>

  exportMemories: (payload: { userId: string }) => Promise<MemoryRecord[]>

  getSettings: () => Promise<MemorySettings>

  updateSettings: (payload: Partial<MemorySettings>) => Promise<MemorySettings>

  getStats: () => Promise<{ totalMemories: number, activeMemories: number, expiredMemories: number, dbSizeBytes: number }>
}

export const useMemoryStore = defineStore('memory', () => {
  const ipcProvider = ref<MemoryIPCProvider | null>(null)
  const enabled = ref(false)

  /**
   * Sets the IPC provider. Called once during app initialization.
   * Only works in Electron context.
   */
  function setIPCProvider(provider: MemoryIPCProvider): void {
    ipcProvider.value = provider
    enabled.value = true
  }

  function requireProvider(): MemoryIPCProvider {
    if (!ipcProvider.value) {
      throw new Error('Memory IPC provider not initialized')
    }
    return ipcProvider.value
  }

  async function search(payload: {
    userId: string
    query?: string
    projectId?: string | null
    type?: MemoryType
    limit?: number
    offset?: number
  }): Promise<MemoryRecord[]> {
    return requireProvider().search(payload)
  }

  async function listActive(userId: string, limit?: number): Promise<MemoryRecord[]> {
    return requireProvider().listActive({ userId, limit })
  }

  async function deleteMemory(id: number): Promise<void> {
    return requireProvider().delete({ id })
  }

  async function forget(userId: string, query: string, projectId?: string | null): Promise<number> {
    const result = await requireProvider().forget({ userId, query, projectId })
    return result.deletedCount
  }

  async function exportMemories(userId: string): Promise<MemoryRecord[]> {
    return requireProvider().exportMemories({ userId })
  }

  async function getSettings(): Promise<MemorySettings> {
    return requireProvider().getSettings()
  }

  async function updateSettings(settings: Partial<MemorySettings>): Promise<MemorySettings> {
    return requireProvider().updateSettings(settings)
  }

  async function getStats(): Promise<{ totalMemories: number, activeMemories: number, expiredMemories: number, dbSizeBytes: number }> {
    return requireProvider().getStats()
  }

  return {
    enabled,
    setIPCProvider,
    search,
    listActive,
    deleteMemory,
    forget,
    exportMemories,
    getSettings,
    updateSettings,
    getStats,
  }
})
