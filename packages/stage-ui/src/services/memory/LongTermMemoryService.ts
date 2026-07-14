import type {
  MemoryRecord,
  MemorySettings,
  MemoryType,
  StoreMemoryPayload,
} from './types'

/**
 * Renderer-side wrapper for long-term memory IPC operations.
 *
 * Uses the eventa IPC bridge provided by `@moeru/eventa`'s `electron` adapter
 * to call memory handlers registered in the Electron main process.
 *
 * This service never opens the SQLite database directly — all database access
 * goes through type-safe IPC.
 */

export interface MemoryServiceIPC {
  /** Store a new memory. */
  memoryStore: (payload: StoreMemoryPayload) => Promise<MemoryRecord>
  /** Retrieve relevant memories for a query using FTS5. */
  memoryRetrieve: (payload: { userId: string, query: string, projectId?: string | null, maxResults?: number }) => Promise<MemoryRecord[]>
  /** Search memories with filters. */
  memorySearch: (payload: { userId: string, query?: string, projectId?: string | null, type?: MemoryType, limit?: number, offset?: number }) => Promise<MemoryRecord[]>
  /** Get a single memory by ID. */
  memoryGetById: (payload: { id: number }) => Promise<MemoryRecord | null>
  /** Update an existing memory. */
  memoryUpdate: (payload: { id: number, content?: string, importance?: number, [key: string]: unknown }) => Promise<MemoryRecord>
  /** Soft-delete a memory. */
  memoryDelete: (payload: { id: number }) => Promise<void>
  /** Forget memories by keyword query. */
  memoryForget: (payload: { userId: string, query: string, projectId?: string | null }) => Promise<{ deletedCount: number }>
  /** Delete all memories for a project. */
  memoryForgetByProject: (payload: { userId: string, projectId: string }) => Promise<{ deletedCount: number }>
  /** List active memories. */
  memoryListActive: (payload: { userId: string, limit?: number }) => Promise<MemoryRecord[]>
  /** Export all memories as JSON. */
  memoryExport: (payload: { userId: string }) => Promise<MemoryRecord[]>
  /** Get memory settings. */
  memoryGetSettings: () => Promise<MemorySettings>
  /** Update memory settings. */
  memoryUpdateSettings: (payload: Partial<MemorySettings>) => Promise<MemorySettings>
}

/**
 * Creates a LongTermMemoryService backed by the given IPC bridge.
 *
 * The IPC parameter should come from the eventa electron adapter's
 * invoke functions, wired up in the renderer entry point.
 */
export function createLongTermMemoryService(ipc: MemoryServiceIPC) {
  return {
    async store(payload: StoreMemoryPayload): Promise<MemoryRecord> {
      return ipc.memoryStore(payload)
    },

    async retrieve(query: string, userId: string, projectId?: string | null, maxResults?: number): Promise<MemoryRecord[]> {
      return ipc.memoryRetrieve({ userId, query, projectId, maxResults })
    },

    async search(userId: string, opts?: { query?: string, projectId?: string | null, type?: MemoryType, limit?: number, offset?: number }): Promise<MemoryRecord[]> {
      return ipc.memorySearch({
        userId,
        query: opts?.query,
        projectId: opts?.projectId,
        type: opts?.type,
        limit: opts?.limit ?? 20,
        offset: opts?.offset ?? 0,
      })
    },

    async getById(id: number): Promise<MemoryRecord | null> {
      return ipc.memoryGetById({ id })
    },

    async update(id: number, fields: Partial<Pick<MemoryRecord, 'content' | 'importance' | 'subject'>>): Promise<MemoryRecord> {
      return ipc.memoryUpdate({ id, ...fields })
    },

    async delete(id: number): Promise<void> {
      return ipc.memoryDelete({ id })
    },

    async forget(userId: string, query: string, projectId?: string | null): Promise<number> {
      const result = await ipc.memoryForget({ userId, query, projectId })
      return result.deletedCount
    },

    async forgetByProject(userId: string, projectId: string): Promise<number> {
      const result = await ipc.memoryForgetByProject({ userId, projectId })
      return result.deletedCount
    },

    async listActive(userId: string, limit?: number): Promise<MemoryRecord[]> {
      return ipc.memoryListActive({ userId, limit })
    },

    async exportAll(userId: string): Promise<MemoryRecord[]> {
      return ipc.memoryExport({ userId })
    },

    async getSettings(): Promise<MemorySettings> {
      return ipc.memoryGetSettings()
    },

    async updateSettings(settings: Partial<MemorySettings>): Promise<MemorySettings> {
      return ipc.memoryUpdateSettings(settings)
    },
  }
}

export type LongTermMemoryService = ReturnType<typeof createLongTermMemoryService>
