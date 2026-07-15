import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const storeMemoryParams = z.object({
  subject: z.string().describe('A short title/subject for this memory (max 80 chars).'),
  content: z.string().describe('The full memory content to store. For summaries, keep it to 1-3 concise sentences in Chinese.'),
  type: z.enum(['episode', 'reference', 'preference', 'project', 'decision', 'temporary']).describe(
    'Memory type:\n'
    + '- "episode": something that happened (user shared a link, watched a video, had an idea)\n'
    + '- "reference": factual knowledge worth remembering (article summary, tutorial要点, news)\n'
    + '- "preference": user likes/dislikes/prefers something\n'
    + '- "project": project-related info\n'
    + '- "decision": user made a choice or decision\n'
    + '- "temporary": short-lived info (auto-expires after TTL)',
  ).optional(),
  importance: z.number().min(0).max(1).describe('Importance 0-1. Use 0.7-0.9 for noteworthy content, 0.9-1.0 for critical/decision-level info.').optional(),
})

/**
 * Store a memory directly to the long-term memory database (SQLite + FTS5).
 *
 * Use this when:
 * - The user explicitly says "记住" / "存下来" / "save this" / "remember"
 * - You've just summarized a web article or video and the user confirmed storage
 * - The user shares important personal info, preferences, or decisions
 * - After using fetch_url to get page content, store the 1-2 sentence summary
 *
 * Do NOT call this for:
 * - Small talk or greetings
 * - One-off questions ("今天天气怎么样")
 * - Temporary queries unless the user explicitly asks to remember
 */
async function executeStoreMemory(input: {
  subject: string
  content: string
  type?: string
  importance?: number
}): Promise<string> {
  if (!input.subject?.trim() || !input.content?.trim()) {
    return '❌ 记忆存储失败：主题和内容不能为空。'
  }

  try {
    const result = await (window as any).electron.ipcRenderer.invoke('memory:store-tool', {
      subject: input.subject.trim(),
      content: input.content.trim(),
      type: input.type ?? 'episode',
      importance: input.importance ?? 0.7,
    })

    if (!result?.ok) {
      return `❌ 记忆存储失败：${result?.error ?? '未知错误'}`
    }

    console.info('[storeMemory] stored:', input.subject, `id=${result.id}`)
    return `✅ 已存入长期记忆 [id=${result.id}]：**${input.subject}**`
  }
  catch (error) {
    console.error('[storeMemory] failed:', error)
    return `❌ 记忆存储失败：${errorMessageFrom(error) ?? 'IPC 错误'}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'store_memory',
    description: [
      'Store a piece of information to long-term memory (SQLite database with FTS5 search).',
      '',
      'When to use:',
      '- User says "记住" / "存下来" / "save this" / "remember"',
      '- After summarizing a web article or video fetched via fetch_url',
      '- User shares important preferences, decisions, or project context',
      '',
      'When NOT to use:',
      '- Small talk (你好, 晚安)',
      '- One-off queries (今天天气怎么样)',
      '- Unless user explicitly asks to remember',
      '',
      'Content should be a concise summary (1-3 sentences in Chinese).',
      'For web content summaries, include the key takeaway, not the full article.',
    ].join('\n'),
    execute: executeStoreMemory,
    parameters: storeMemoryParams,
  }),
]

export const storeMemoryTools = async () => Promise.all(tools)
