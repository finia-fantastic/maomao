import type { LongTermMemoryService } from './LongTermMemoryService'
import type { MemoryExtractionResult, MemoryRecord, StoreMemoryPayload } from './types'

/**
 * Memory consolidation service.
 *
 * Handles deduplication and conflict resolution:
 * - Dedup via memoryKey: new value supersedes old (don't create duplicates)
 * - Old record status becomes 'superseded', new record links to old via supersedesId
 * - User corrections always have highest priority
 */

/**
 * Consolidates a new memory extraction result into the store.
 *
 * If an existing memory with the same `memoryKey` exists and is active,
 * it will be superseded. Corrections get special handling.
 */
export async function consolidateMemory(
  service: LongTermMemoryService,
  extraction: MemoryExtractionResult,
  userId: string,
  options?: {
    sourceSessionId?: string | null
    sourceMessageId?: string | null
    projectId?: string | null
    ttlSeconds?: number | null
  },
): Promise<MemoryRecord | null> {
  if (!extraction.shouldStore) return null

  const payload: StoreMemoryPayload = {
    userId,
    projectId: options?.projectId ?? extraction.projectId ?? null,
    type: extraction.type ?? 'episode',
    memoryKey: extraction.memoryKey ?? `episode:${Date.now()}`,
    subject: extraction.subject ?? 'Untitled memory',
    content: extraction.content ?? '',
    importance: extraction.importance ?? 0.5,
    confidence: extraction.type === 'correction' ? 1.0 : (extraction.confidence ?? 0.8),
    sensitive: extraction.sensitive ?? false,
    sourceSessionId: options?.sourceSessionId ?? null,
    sourceMessageId: options?.sourceMessageId ?? null,
    ttlSeconds: options?.ttlSeconds ?? extraction.ttlSeconds ?? null,
  }

  return service.store(payload)
}

/**
 * Consolidates multiple extraction results.
 *
 * For corrections: apply them last so they take priority.
 */
export async function consolidateMemories(
  service: LongTermMemoryService,
  extractions: MemoryExtractionResult[],
  userId: string,
  options?: {
    sourceSessionId?: string | null
    sourceMessageId?: string | null
    projectId?: string | null
    ttlSeconds?: number | null
  },
): Promise<MemoryRecord[]> {
  const results: MemoryRecord[] = []

  // Sort: corrections last (highest priority)
  const sorted = [...extractions].sort((a, b) => {
    if (a.type === 'correction' && b.type !== 'correction') return 1
    if (a.type !== 'correction' && b.type === 'correction') return -1
    return 0
  })

  for (const extraction of sorted) {
    const record = await consolidateMemory(service, extraction, userId, options)
    if (record) results.push(record)
  }

  return results
}
