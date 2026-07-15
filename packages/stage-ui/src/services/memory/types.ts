/** Re-export the memory types from the shared eventa contracts. */

// These types mirror the shared contracts in `apps/stage-tamagotchi/src/shared/eventa/memory.ts`
// but are defined here to avoid stage-ui depending on stage-tamagotchi internals.

export type MemoryType
  = | 'profile'
    | 'preference'
    | 'project'
    | 'decision'
    | 'relationship'
    | 'episode'
    | 'commitment'
    | 'correction'
    | 'temporary'

export type MemoryStatus = 'active' | 'superseded' | 'expired' | 'deleted'

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

export interface RetrieveMemoriesPayload {
  userId: string
  query: string
  projectId?: string | null
  maxResults?: number
  maxTokens?: number
}

export interface SearchMemoriesPayload {
  userId: string
  query?: string
  projectId?: string | null
  type?: MemoryType
  limit?: number
  offset?: number
}

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
