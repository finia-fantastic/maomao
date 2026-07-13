export type VisionWorkloadId = 'screen:interpret' | 'screen:understand' | 'screen:ocr' | 'screen:ui-automation' | 'screen:commentary' | 'screen:english-reader'

export interface VisionWorkloadConfig {
  id: VisionWorkloadId
  label: string
  description: string
  prompt: string
}

export const VISION_WORKLOADS: VisionWorkloadConfig[] = [
  {
    id: 'screen:interpret',
    label: 'Screen interpret',
    description: 'Summarize what is on screen and relevant UI state.',
    prompt: [
      'You are an on-device vision assistant.',
      'Interpret the current screen in a concise, structured summary:',
      '- identify the active app or page',
      '- list key UI elements and their states',
      '- call out user intent or next likely action',
      'Keep it factual and short, avoid speculation.',
    ].join('\n'),
  },
  {
    id: 'screen:understand',
    label: 'Screen understanding',
    description: 'Explain screen intent and key tasks.',
    prompt: [
      'Explain what the screen is for and what the user can do next.',
      'Focus on primary actions, warnings, and notable state changes.',
    ].join('\n'),
  },
  {
    id: 'screen:ocr',
    label: 'OCR focus',
    description: 'Extract readable text from the screen.',
    prompt: [
      'Extract visible text from the screen.',
      'Return plain text, preserve structure with line breaks when possible.',
    ].join('\n'),
  },
  {
    id: 'screen:ui-automation',
    label: 'UI automation',
    description: 'Describe actionable UI elements for automation.',
    prompt: [
      'Identify actionable UI elements (buttons, inputs, menus).',
      'Return a list of elements with labels and approximate purpose.',
    ].join('\n'),
  },
  {
    id: 'screen:commentary',
    label: 'Screen commentary',
    description: 'Casual, conversational description of what the user is doing, for use by the desktop pet.',
    prompt: [
      'You are a friendly desktop companion watching the user\'s screen.',
      'Describe what you see in 2-3 sentences, in a casual, conversational tone.',
      'Mention: what app or website is open, what the user seems to be doing, anything notable or fun.',
      'Keep it light, warm, and brief — like a pet commenting on what their owner is up to.',
      'Do NOT use markdown, lists, or technical jargon. Just a natural spoken comment.',
    ].join('\n'),
  },
  {
    id: 'screen:english-reader',
    label: 'English word reader',
    description: 'Extract English words from screen for TTS reading.',
    prompt: [
      'You are an English reading assistant.',
      'Look at this screenshot and extract ALL visible English words and sentences.',
      'Return ONLY the English text, separated by spaces. No Chinese, no explanations.',
      'Preserve the order: top to bottom, left to right.',
      'If there are multiple lines, join them with commas.',
      'Example output: "apple, banana, cherry, This is a sentence."',
    ].join('\n'),
  },
]

export function getVisionWorkload(id: VisionWorkloadId) {
  return VISION_WORKLOADS.find(workload => workload.id === id) || VISION_WORKLOADS[0]
}
