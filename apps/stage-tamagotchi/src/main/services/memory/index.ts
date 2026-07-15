import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import {
  memoryDelete,
  memoryExport,
  memoryForget,
  memoryForgetByProject,
  memoryGetById,
  memoryGetSettings,
  memoryGetStats,
  memoryListActive,
  memoryRetrieve,
  memorySearch,
  memoryStore,
  memoryUpdate,
  memoryUpdateSettings,
} from '../../../shared/eventa/memory'
import {
  deleteMemory,
  exportMemories,
  forgetMemories,
  forgetMemoriesByProject,
  getMemoryById,
  getMemoryDatabase,
  getSettings,
  getStats,
  listActiveMemories,
  retrieveMemories,
  searchMemories,
  storeMemory,
  updateMemory,
  updateSettings,
} from './MemoryDatabase'

export { closeMemoryDatabase, getMemoryDatabase } from './MemoryDatabase'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Initializes the memory database singleton.
 *
 * Must be called once during app startup in the main process
 * (`app.whenReady()`). Safe to call multiple times — it is
 * idempotent (the singleton ignores subsequent calls).
 */
export function initMemoryDatabase(): void {
  getMemoryDatabase(app.getPath('userData'))
}

/**
 * Registers all memory-related IPC handlers on an eventa window context.
 *
 * Follows the pattern of `createVocabDbService` — stateless, safe to call
 * once per window context. Uses the singleton database handle.
 */
export function createMemoryService(context: MainContext): void {
  // db singleton is already initialized by `initMemoryDatabase()` called during startup
  const db = getMemoryDatabase(app.getPath('userData'))

  defineInvokeHandler(context, memoryStore, async (payload) => {
    const settings = getSettings(db)
    if (!settings.enableLongTermMemory) {
      throw new Error('Long-term memory is disabled')
    }
    // NOTICE: Sensitive memory check — if sensitive flag is set but enableSensitiveMemory is off, reject
    if (payload.sensitive && !settings.enableSensitiveMemory) {
      throw new Error('Sensitive memory storage is disabled')
    }
    return storeMemory(db, payload)
  })

  defineInvokeHandler(context, memoryRetrieve, async (payload) => {
    const settings = getSettings(db)
    const maxResults = payload.maxResults ?? settings.maxRetrievedMemories
    return retrieveMemories(db, payload.userId, payload.query, payload.projectId, maxResults)
  })

  defineInvokeHandler(context, memorySearch, async (payload) => {
    return searchMemories(
      db,
      payload.userId,
      payload.query,
      payload.projectId,
      payload.type,
      payload.limit,
      payload.offset,
    )
  })

  defineInvokeHandler(context, memoryGetById, async (payload) => {
    return getMemoryById(db, payload.id)
  })

  defineInvokeHandler(context, memoryUpdate, async (payload) => {
    return updateMemory(db, payload)
  })

  defineInvokeHandler(context, memoryDelete, async (payload) => {
    deleteMemory(db, payload.id)
  })

  defineInvokeHandler(context, memoryForget, async (payload) => {
    const count = forgetMemories(db, payload.userId, payload.query, payload.projectId)
    return { deletedCount: count }
  })

  defineInvokeHandler(context, memoryForgetByProject, async (payload) => {
    const count = forgetMemoriesByProject(db, payload.userId, payload.projectId)
    return { deletedCount: count }
  })

  defineInvokeHandler(context, memoryListActive, async (payload) => {
    return listActiveMemories(db, payload.userId, payload.limit ?? 20)
  })

  defineInvokeHandler(context, memoryExport, async (payload) => {
    return exportMemories(db, payload.userId)
  })

  defineInvokeHandler(context, memoryGetSettings, async () => {
    return getSettings(db)
  })

  defineInvokeHandler(context, memoryUpdateSettings, async (payload) => {
    return updateSettings(db, payload)
  })

  defineInvokeHandler(context, memoryGetStats, async () => {
    return getStats(db)
  })
}
