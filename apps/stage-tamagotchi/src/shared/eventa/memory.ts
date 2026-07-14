import { defineInvokeEventa } from '@moeru/eventa'

/** Memory record stored in long-term SQLite database. */
export interface MemoryRecord {
  id: number
  userId: string
  projectId: string | null
  type: MemoryType
  memoryKey: string
  subject: string
  content: string
  importance: number
  confidence: number
  sensitive: boolean
  sourceSessionId: string | null
  sourceMessageId: string | null
  supersedesId: number | null
  status: MemoryStatus
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
  expiresAt: string | null
  metadata: Record<string, unknown> | null
}

export type MemoryType =
  | 'profile'
  | 'preference'
  | 'project'
  | 'decision'
  | 'relationship'
  | 'episode'
  | 'commitment'
  | 'correction'
  | 'temporary'

export type MemoryStatus = 'active' | 'superseded' | 'expired' | 'deleted'

/** Payload for storing a new memory. */
export interface StoreMemoryPayload {
  userId: string
  projectId?: string | null
  type: MemoryType
  memoryKey: string
  subject: string
  content: string
  importance?: number
  confidence?: number
  sensitive?: boolean
  sourceSessionId?: string | null
  sourceMessageId?: string | null
  ttlSeconds?: number | null
  metadata?: Record<string, unknown> | null
}

/** Payload for updating an existing memory. */
export interface UpdateMemoryPayload {
  id: number
  subject?: string
  content?: string
  importance?: number
  confidence?: number
  sensitive?: boolean
  type?: MemoryType
  metadata?: Record<string, unknown> | null
}

/** Payload for retrieving memories. */
export interface RetrieveMemoriesPayload {
  userId: string
  query: string
  projectId?: string | null
  maxResults?: number
  maxTokens?: number
}

/** Payload for searching memories. */
export interface SearchMemoriesPayload {
  userId: string
  query?: string
  projectId?: string | null
  type?: MemoryType
  limit?: number
  offset?: number
}

/** Payload for forgetting memories by keyword. */
export interface ForgetMemoriesPayload {
  userId: string
  query: string
  projectId?: string | null
}

/** Memory settings stored in the database. */
export interface MemorySettings {
  enableLongTermMemory: boolean
  enableSessionSummary: boolean
  enableSensitiveMemory: boolean
  defaultTemporaryTTL: number
  maxRetrievedMemories: number
  maxMemoryPromptTokens: number
}

/** Result of a memory extraction evaluation. */
export interface MemoryExtractionResult {
  shouldStore: boolean
  type?: MemoryType
  projectId?: string
  memoryKey?: string
  subject?: string
  content?: string
  importance?: number
  confidence?: number
  ttlSeconds?: number
  sensitive?: boolean
  reason: string
}

/** Stats about the memory database. */
export interface MemoryDatabaseStats {
  totalMemories: number
  activeMemories: number
  expiredMemories: number
  dbSizeBytes: number
}

// ---- Invoke eventas for renderer → main process memory operations ----

/** Store a new memory record. Returns the created memory. */
export const memoryStore = defineInvokeEventa<MemoryRecord, StoreMemoryPayload>('eventa:invoke:memory:store')

/** Retrieve relevant memories for a query using FTS5. */
export const memoryRetrieve = defineInvokeEventa<MemoryRecord[], RetrieveMemoriesPayload>('eventa:invoke:memory:retrieve')

/** Search memories with optional filters. */
export const memorySearch = defineInvokeEventa<MemoryRecord[], SearchMemoriesPayload>('eventa:invoke:memory:search')

/** Get a single memory by ID. */
export const memoryGetById = defineInvokeEventa<MemoryRecord | null, { id: number }>('eventa:invoke:memory:get-by-id')

/** Update an existing memory. */
export const memoryUpdate = defineInvokeEventa<MemoryRecord, UpdateMemoryPayload>('eventa:invoke:memory:update')

/** Soft-delete a memory by ID. */
export const memoryDelete = defineInvokeEventa<void, { id: number }>('eventa:invoke:memory:delete')

/** Forget memories matching a keyword query. Returns the count deleted. */
export const memoryForget = defineInvokeEventa<{ deletedCount: number }, ForgetMemoriesPayload>('eventa:invoke:memory:forget')

/** Delete all memories for a specific project. */
export const memoryForgetByProject = defineInvokeEventa<{ deletedCount: number }, { userId: string, projectId: string }>('eventa:invoke:memory:forget-by-project')

/** List active memories (for "你记得我什么" queries). */
export const memoryListActive = defineInvokeEventa<MemoryRecord[], { userId: string, limit?: number }>('eventa:invoke:memory:list-active')

/** Export all memories as JSON. */
export const memoryExport = defineInvokeEventa<MemoryRecord[], { userId: string }>('eventa:invoke:memory:export')

/** Get memory settings. */
export const memoryGetSettings = defineInvokeEventa<MemorySettings>('eventa:invoke:memory:get-settings')

/** Update memory settings. */
export const memoryUpdateSettings = defineInvokeEventa<MemorySettings, Partial<MemorySettings>>('eventa:invoke:memory:update-settings')

/** Get memory database stats. */
export const memoryGetStats = defineInvokeEventa<MemoryDatabaseStats>('eventa:invoke:memory:get-stats')
