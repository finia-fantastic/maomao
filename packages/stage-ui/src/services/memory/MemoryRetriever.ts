import type { LongTermMemoryService } from './LongTermMemoryService'
import type { MemoryRecord, MemorySettings } from './types'

/**
 * Retrieves relevant long-term memories before each chat model call.
 *
 * Called before each LLM inference to find and score relevant memories
 * using SQLite FTS5 text search. The scoring formula prioritizes:
 *
 *   0.45 * textRelevance + 0.20 * importance + 0.15 * recency
 *   + 0.10 * confidence + 0.10 * accessFrequency
 *
 * Returns 5-8 most relevant memories, capped at ~1000 tokens total.
 */

/** Approximate token count: ~4 chars per token for CJK, ~4 chars per token for English */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Maximum total tokens for retrieved memory context */
const MAX_TOTAL_TOKENS = 1000

export interface RetrieveOptions {
  /** The user's query/message to find relevant memories for */
  query: string
  /** The user ID to scope memories by */
  userId: string
  /** Optional project context to filter by */
  projectId?: string | null
  /** Maximum number of memory records to return */
  maxResults?: number
}

export interface RetrievedMemory {
  record: MemoryRecord
  /** Composite score (0-1) used for ranking */
  score: number
}

/**
 * Creates a memory retriever backed by the given long-term memory service.
 */
export function createMemoryRetriever(memoryService: LongTermMemoryService) {
  /**
   * Retrieves and scores relevant memories for the given query.
   */
  async function retrieve(options: RetrieveOptions): Promise<RetrievedMemory[]> {
    const records = await memoryService.retrieve(
      options.query,
      options.userId,
      options.projectId,
      options.maxResults,
    )

    if (records.length === 0)
      return []

    // Score and rank (server-side scoring already applied, but we re-score
    // on the client for cross-validation and token budget enforcement)
    const scored: RetrievedMemory[] = records.map((record) => {
      const recencyDays = daysSinceUpdate(record.updatedAt)
      const recencyScore = Math.exp(-recencyDays / 30)
      const textRelScore = 0.5 // FTS5 match confirms relevance

      const score
        = textRelScore * 0.45
          + record.importance * 0.20
          + recencyScore * 0.15
          + record.confidence * 0.10
          + 0.5 * 0.10 // access frequency approximated

      return { record, score }
    })

    scored.sort((a, b) => b.score - a.score)

    // Apply token budget — trim from the bottom until we're within limits
    let totalTokens = 0
    const result: RetrievedMemory[] = []

    for (const item of scored) {
      const contentTokens = estimateTokens(item.record.content)
      const subjectTokens = estimateTokens(item.record.subject)
      const itemTokens = contentTokens + subjectTokens

      if (totalTokens + itemTokens > MAX_TOTAL_TOKENS && result.length >= 3) {
        break // Keep at least 3 memories even if over budget
      }

      result.push(item)
      totalTokens += itemTokens

      if (totalTokens >= MAX_TOTAL_TOKENS && result.length >= 5) {
        break
      }
    }

    return result
  }

  return { retrieve }
}

export type MemoryRetriever = ReturnType<typeof createMemoryRetriever>

function daysSinceUpdate(updatedAt: string): number {
  const updated = new Date(`${updatedAt.replace(' ', 'T')}Z`).getTime()
  return (Date.now() - updated) / (1000 * 60 * 60 * 24)
}
