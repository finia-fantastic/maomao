/**
 * Game Learning System — types for teaching/practice/assisted modes.
 *
 * Teaching flow:
 *   User plays → keys recorded → before/after frames captured
 *   → demonstrations stored → AI summarizes → user confirms
 *   → skill saved to SQLite → reusable in practice/assisted modes
 */

export type GameLearningMode = 'disabled' | 'teaching' | 'practice' | 'assisted'

export interface GameObservation {
  gameMode: 'exploration' | 'dialog' | 'menu' | 'battle' | 'loading' | 'unknown'
  sceneSummary: string
  visibleText: string[]
  interactionPrompt?: string
  dialogVisible: boolean
  menuVisible: boolean
  loadingVisible: boolean
}

export interface DemonstratedAction {
  type: 'key_tap' | 'key_hold' | 'mouse_click'
  key?: string
  durationMs?: number
  button?: 'left' | 'right' | 'middle'
  normalizedX?: number
  normalizedY?: number
}

export interface DemonstrationStep {
  episodeId: string
  sequence: number
  capturedAt: number
  beforeFrameId: string
  beforeSummary: string
  action: DemonstratedAction
  afterFrameId?: string
  afterSummary?: string
  success?: boolean
  userNote?: string
}

export interface TeachingEpisode {
  id: string
  gameId: string
  title: string
  startedAt: number
  endedAt?: number
  stepCount: number
  summary?: string
  status: 'recording' | 'review' | 'confirmed' | 'discarded'
}

export interface LearnedGameSkill {
  id: string
  gameId: string
  name: string
  description: string
  preconditions: {
    gameModes?: string[]
    requiredVisibleText?: string[]
    interactionPrompt?: string
  }
  actions: Array<{
    type: string
    key?: string
    durationMs?: number
    button?: string
  }>
  expectedResults: {
    gameMode?: string
    dialogVisible?: boolean
    menuVisible?: boolean
  }
  timeoutMs: number
  confidence: number
  demonstrationCount: number
  successCount: number
  failureCount: number
  status: 'draft' | 'confirmed' | 'disabled'
  sourceEpisodeIds: string[]
  createdAt: number
  updatedAt: number
}
