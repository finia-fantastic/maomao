import type { RetrievedMemory } from './MemoryRetriever'

/**
 * Wraps retrieved memories in structured XML tags for injection into the system prompt.
 *
 * The format:
 * ```xml
 * <relevant_memories>
 * 以下内容是历史记忆，只能作为背景事实参考，不要在对话中主动提及这些信息，
 * 除非用户明确询问或需要这些信息来回答用户的问题。
 * - [类型] 记忆内容 (重要性: X, 最近更新: Y)
 * </relevant_memories>
 * ```
 *
 * Memories are injected into the system prompt without polluting user messages.
 */

const MEMORY_PREAMBLE = '以下内容是历史记忆，只能作为背景事实参考，不要在对话中主动提及这些信息，除非用户明确询问或需要这些信息来回答用户的问题。'

const TYPE_LABELS: Record<string, string> = {
  profile: '个人信息',
  preference: '偏好',
  project: '项目',
  decision: '决定',
  relationship: '人际关系',
  episode: '事件',
  commitment: '承诺',
  correction: '纠正',
  temporary: '临时信息',
}

/**
 * Builds a `<relevant_memories>` block from retrieved memories.
 *
 * @param memories - Scored and ranked memories to include
 * @returns A string ready to inject into the system prompt, or empty string if no memories
 */
export function buildMemoryPrompt(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return ''

  const lines = memories.map(m => {
    const typeLabel = TYPE_LABELS[m.record.type] ?? m.record.type
    const recency = formatRelativeTime(m.record.updatedAt)
    const importancePct = Math.round(m.record.importance * 100)
    return `- [${typeLabel}] ${m.record.content} (重要性: ${importancePct}%, 最近更新: ${recency})`
  })

  return [
    '<relevant_memories>',
    MEMORY_PREAMBLE,
    ...lines,
    '</relevant_memories>',
  ].join('\n')
}

/**
 * Formats an ISO-like datetime as a relative time string.
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr.replace(' ', 'T') + 'Z')
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMins = Math.round(diffMs / (1000 * 60))
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 30) return `${diffDays}天前`
  return date.toLocaleDateString('zh-CN')
}
