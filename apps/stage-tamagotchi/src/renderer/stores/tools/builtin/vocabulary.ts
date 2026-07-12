import type { Tool } from '@xsai/shared-chat'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { electronVocabStats } from '../../../../shared/eventa'

// -- LLM Tool --

/**
 * Reads the user's vocabulary progress from the shared `words.db` (via the main
 * process) and returns a compact Chinese summary for the character to answer with.
 * The invoke context is resolved lazily at call time (during a chat turn), when the
 * renderer's electron-eventa context is guaranteed to be initialized.
 */
async function executeGetVocabularyProgress(): Promise<string> {
  const stats = await useElectronEventaInvoke(electronVocabStats)()

  if (stats.error) {
    return `暂时读不到单词学习数据（${stats.error}）。可能是单词 App 的数据库路径变了，或文件暂时被占用。`
  }

  const recent = stats.recent.length
    ? stats.recent.map(word => `${word.english}（${word.chinese}）`).join('、')
    : '（暂无记录）'

  return [
    '英语单词学习进度：',
    `- 今天新增：${stats.today} 个`,
    `- 总词数：${stats.total} 个`,
    `- 学习中：${stats.learning}，复习中：${stats.reviewing}，已掌握：${stats.mastered}`,
    `- 待复习（今天及以前到期）：${stats.dueForReview} 个`,
    `- 最近学的：${recent}`,
  ].join('\n')
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'get_vocabulary_progress',
    description: 'Query the user\'s English vocabulary-learning progress from their local word-learning app (a shared SQLite database): how many words were added today, the total count, how many are learning / reviewing / mastered, how many are due for review, and the most recently added words with their Chinese meanings. Call this whenever the user asks about their vocabulary, word study, learning progress, how many words they learned today, or what they recently learned.',
    execute: executeGetVocabularyProgress,
    parameters: z.object({}),
  }),
]

export const vocabularyTools = async () => Promise.all(tools)
