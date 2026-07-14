import type { MemoryExtractionResult, MemoryType } from './types'

/**
 * Rules-based memory extraction engine.
 *
 * Called once after each user message is processed to evaluate whether
 * the message content should be stored as a long-term memory.
 *
 * Rules:
 * - SAVE: explicit "remember" commands, stable preferences, long-term projects,
 *   decisions, corrections
 * - DON'T SAVE: small talk, one-off chat, AI-generated unconfirmed info,
 *   passwords/API keys/tokens
 * - Sensitive: don't save unless user explicitly requests storage
 */

/**
 * Keywords and patterns that signal an explicit SAVE intent from the user.
 */
const SAVE_SIGNALS: Array<{ pattern: RegExp, type: MemoryType, priority: number }> = [
  // Chinese explicit remember commands
  { pattern: /(?:记住|记下|记住这个|帮我记住|记住我说|写下来|记着)(?:，|：|:)?(.+)/i, type: 'episode', priority: 10 },
  // English explicit remember commands
  { pattern: /(?:remember|note this|save this|keep this in memory)(?:\s|:|,)?(.+)/i, type: 'episode', priority: 10 },

  // Preferences
  { pattern: /我(?:喜欢|不喜欢|讨厌|偏好|习惯|爱|常用)/i, type: 'preference', priority: 8 },
  { pattern: /I (?:like|love|prefer|hate|dislike|enjoy)/i, type: 'preference', priority: 8 },
  { pattern: /(?:我的|my)\s*(?:偏好|preference|习惯|habit)/i, type: 'preference', priority: 9 },

  // Project/Goal related
  { pattern: /我的(?:项目|计划|目标|project|goal|plan)/i, type: 'project', priority: 7 },
  { pattern: /(?:正在做|在做|working on|working toward)/i, type: 'project', priority: 7 },
  { pattern: /(?:想做一个|想开发|想写|要做|准备做)/i, type: 'project', priority: 7 },

  // Decisions
  { pattern: /(?:决定了|决定|选择|确定用|采用|decision|decided|chose)/i, type: 'decision', priority: 8 },

  // Corrections
  { pattern: /(?:不对|错了|不是这样|纠正|修正|应该是|实际上是|我说的是|我的意思是)/i, type: 'correction', priority: 10 },
  { pattern: /(?:that's wrong|not correct|actually|I meant|correction|that's not right|my mistake)/i, type: 'correction', priority: 10 },

  // Commitments
  { pattern: /(?:我会|我答应|我保证|承诺|I will|I promise|I commit)/i, type: 'commitment', priority: 7 },

  // Relationships
  { pattern: /(?:我的(?:朋友|同事|家人|老师|同学|老板|伴侣)|my (?:friend|colleague|family|teacher|boss|partner))/i, type: 'relationship', priority: 7 },
]

/**
 * Keywords and patterns that signal DON'T SAVE.
 */
const NO_SAVE_SIGNALS: Array<{ pattern: RegExp }> = [
  // Small talk
  { pattern: /^(?:hi|hello|hey|你好|嗨|哈喽|喂|在吗|在不在|早|晚安|下午好)$/i },
  { pattern: /^(?:ok|好的|嗯|哦|知道了|明白了|got it|okay|thanks|谢谢|thank you)$/i },

  // One-off queries
  { pattern: /^(?:今天|今天天气|几点了|现在几点|今天星期几|what time|what day|weather)/i },
  { pattern: /^(?:帮我查|查一下|搜索|search for|look up|google)/i },

  // Temporary/this-session-only
  { pattern: /(?:暂时|临时|这次|就现在|just now|for now|this time)/i },
  { pattern: /这个只在今天有效/i },

  // Credentials / secrets (caught by MemoryPrivacyService too)
  { pattern: /(?:密码|password|token|api.?key|secret|密钥|验证码)/i },
]

/**
 * Minimum message length for auto-extraction (non-explicit commands).
 * Messages shorter than this are only saved if they match an explicit SAVE signal.
 */
const MIN_AUTO_EXTRACT_LENGTH = 15

/**
 * Evaluates a user message and returns an extraction decision.
 *
 * @param text - The user's message text
 * @param currentProjectId - The active project ID, if any
 * @returns An extraction result describing whether and how to store
 */
export function evaluateForMemory(
  text: string,
  currentProjectId?: string | null,
): MemoryExtractionResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { shouldStore: false, reason: 'Empty message' }
  }

  // Check explicit SAVE signals first
  for (const signal of SAVE_SIGNALS) {
    const match = trimmed.match(signal.pattern)
    if (match) {
      // Extract the content after the save command if present
      const capturedContent = match[1]?.trim()

      // For explicit "remember" commands, use the captured content as the subject
      if (signal.priority >= 10 && capturedContent && capturedContent.length > 3) {
        return {
          shouldStore: true,
          type: signal.type,
          memoryKey: generateMemoryKey(signal.type, capturedContent.slice(0, 40)),
          subject: capturedContent.slice(0, 80),
          content: capturedContent,
          importance: Math.min(0.5 + signal.priority * 0.05, 1.0),
          confidence: signal.type === 'correction' ? 1.0 : 0.9,
          reason: `Explicit save command: ${signal.pattern.source}`,
        }
      }

      // For preference/decision/project signals, use the whole message
      return {
        shouldStore: true,
        type: signal.type,
        memoryKey: generateMemoryKey(signal.type, trimmed.slice(0, 40)),
        subject: trimmed.slice(0, 80),
        content: trimmed,
        importance: Math.min(0.5 + signal.priority * 0.05, 1.0),
        confidence: signal.type === 'correction' ? 1.0 : 0.85,
        reason: `Matched save signal: ${signal.pattern.source}`,
      }
    }
  }

  // Check DON'T SAVE signals
  for (const signal of NO_SAVE_SIGNALS) {
    if (signal.pattern.test(trimmed)) {
      return { shouldStore: false, reason: `Matched no-save signal: ${signal.pattern.source}` }
    }
  }

  // Short messages without explicit save intent are not stored
  if (trimmed.length < MIN_AUTO_EXTRACT_LENGTH) {
    return { shouldStore: false, reason: 'Too short for auto-extraction' }
  }

  // For longer messages, check if they contain substantial information worth saving
  // NOTICE: This is a heuristic — longer messages that pass the no-save filters
  // may still be save-worthy if they contain personal information or decisions.
  // The heuristic is intentionally conservative here; a future AI-based extractor
  // could replace this rules engine for more nuanced decisions.
  if (trimmed.length >= 40 && hasPersonalContent(trimmed)) {
    return {
      shouldStore: true,
      type: 'episode',
      memoryKey: generateMemoryKey('episode', trimmed.slice(0, 40)),
      subject: trimmed.slice(0, 80),
      content: trimmed,
      importance: 0.5,
      confidence: 0.7,
      reason: 'Substantial personal content detected',
    }
  }

  return { shouldStore: false, reason: 'No save signal detected' }
}

/**
 * Simple heuristic: does the text contain personal content indicators
 * like first-person pronouns combined with factual statements?
 */
function hasPersonalContent(text: string): boolean {
  const personalIndicators = [
    /我(?:是|有|的|想|要|觉得|认为)/i,
    /I (?:am|have|want|need|think|believe|feel|work)/i,
    /my\s+\w+/i,
  ]
  return personalIndicators.some(p => p.test(text))
}

/**
 * Generates a normalized memory key from type and content.
 * The key is used for deduplication in the MemoryConsolidator.
 */
function generateMemoryKey(type: MemoryType, content: string): string {
  const normalized = content
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：""''、（）《》【】…]/g, '')
    .replace(/[,!?;:'"()\[\]{}<>.]/g, '')
    .trim()
    .slice(0, 60)
    .toLowerCase()
  return `${type}:${normalized}`
}
