import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * A single conversation turn stored in working memory.
 */
export interface ConversationTurn {
  /** The user's message text */
  userMessage: string
  /** The assistant's response text */
  assistantMessage: string
  /** Timestamp when this turn was recorded */
  timestamp: number
}

/**
 * Working memory — ephemeral, in-memory only storage that disappears on app close.
 *
 * Stores:
 * - Last 12-20 conversation turns
 * - Current project context
 * - Current goals
 * - Open questions
 * - Recent corrections
 * - Current pet action/emotion information
 */

/** Maximum number of conversation turns to retain in working memory. */
const MAX_TURNS = 20
/** Minimum turns to keep even when pruning. */
const MIN_TURNS = 12

export const useWorkingMemoryStore = defineStore('memory:working', () => {
  // Conversation turns (rolling window)
  const turns = ref<ConversationTurn[]>([])

  // Current context
  const currentProject = ref<string | null>(null)
  const currentGoals = ref<string[]>([])
  const openQuestions = ref<string[]>([])
  const recentCorrections = ref<{ original: string, corrected: string, timestamp: number }[]>([])

  // Current pet state
  const currentAction = ref<string>('idle')
  const currentEmotion = ref<string>('neutral')

  /**
   * Add a conversation turn to working memory.
   * Automatically prunes old turns when exceeding MAX_TURNS.
   */
  function addTurn(userMessage: string, assistantMessage: string): void {
    turns.value.push({
      userMessage,
      assistantMessage,
      timestamp: Date.now(),
    })

    // Prune oldest turns when exceeding max
    if (turns.value.length > MAX_TURNS) {
      turns.value = turns.value.slice(turns.value.length - MIN_TURNS)
    }
  }

  /**
   * Set the current project context.
   */
  function setCurrentProject(project: string | null): void {
    currentProject.value = project
  }

  /**
   * Add a goal to working memory.
   * Deduplicates by goal text.
   */
  function addGoal(goal: string): void {
    if (!currentGoals.value.includes(goal)) {
      currentGoals.value.push(goal)
    }
  }

  /**
   * Remove a specific goal.
   */
  function removeGoal(goal: string): void {
    currentGoals.value = currentGoals.value.filter(g => g !== goal)
  }

  /**
   * Clear all goals.
   */
  function clearGoals(): void {
    currentGoals.value = []
  }

  /**
   * Add an open question.
   */
  function addQuestion(question: string): void {
    if (!openQuestions.value.includes(question)) {
      openQuestions.value.push(question)
    }
  }

  /**
   * Mark a question as resolved.
   */
  function resolveQuestion(question: string): void {
    openQuestions.value = openQuestions.value.filter(q => q !== question)
  }

  /**
   * Add a recent correction to working memory.
   */
  function addCorrection(original: string, corrected: string): void {
    recentCorrections.value.push({ original, corrected, timestamp: Date.now() })

    // Keep only the last 5 corrections
    if (recentCorrections.value.length > 5) {
      recentCorrections.value = recentCorrections.value.slice(-5)
    }
  }

  /**
   * Set the current pet action.
   */
  function setAction(action: string): void {
    currentAction.value = action
  }

  /**
   * Set the current pet emotion.
   */
  function setEmotion(emotion: string): void {
    currentEmotion.value = emotion
  }

  /**
   * Skip the last message — remove it from working memory.
   * Used by the "不要记住刚才的内容" chat keyword.
   */
  function skipLastTurn(): void {
    if (turns.value.length > 0) {
      turns.value.pop()
    }
  }

  /**
   * Build a summary of working memory state for system prompt injection.
   */
  function getSummary(): string {
    const parts: string[] = []

    if (currentProject.value) {
      parts.push(`当前项目: ${currentProject.value}`)
    }

    if (currentGoals.value.length > 0) {
      parts.push(`当前目标: ${currentGoals.value.join('、')}`)
    }

    if (openQuestions.value.length > 0) {
      parts.push(`待解决问题: ${openQuestions.value.join('、')}`)
    }

    if (recentCorrections.value.length > 0) {
      const latest = recentCorrections.value[recentCorrections.value.length - 1]
      if (latest) {
        parts.push(`最近纠正: 原"${latest.original}" → "${latest.corrected}"`)
      }
    }

    if (turns.value.length > 0) {
      parts.push(`最近对话轮次: ${turns.value.length}`)
    }

    return parts.length > 0
      ? `<working_memory>\n${parts.join('\n')}\n</working_memory>`
      : ''
  }

  /**
   * Get the last N conversation turns as text.
   */
  function getRecentConversation(n: number = 5): string {
    const recent = turns.value.slice(-n)
    return recent.map(turn =>
      `用户: ${turn.userMessage}\n助手: ${turn.assistantMessage}`,
    ).join('\n\n')
  }

  /**
   * Reset all working memory state.
   */
  function reset(): void {
    turns.value = []
    currentProject.value = null
    currentGoals.value = []
    openQuestions.value = []
    recentCorrections.value = []
    currentAction.value = 'idle'
    currentEmotion.value = 'neutral'
  }

  return {
    // State
    turns,
    currentProject,
    currentGoals,
    openQuestions,
    recentCorrections,
    currentAction,
    currentEmotion,

    // Actions
    addTurn,
    setCurrentProject,
    addGoal,
    removeGoal,
    clearGoals,
    addQuestion,
    resolveQuestion,
    addCorrection,
    setAction,
    setEmotion,
    skipLastTurn,
    getSummary,
    getRecentConversation,
    reset,
  }
})
