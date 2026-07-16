export type VisionWorkloadId = 'screen:interpret' | 'screen:understand' | 'screen:ocr' | 'screen:ui-automation' | 'screen:commentary' | 'screen:english-reader' | 'screen:chat-look'

export interface VisionWorkloadConfig {
  id: VisionWorkloadId
  label: string
  description: string
  prompt: string
}

export const VISION_WORKLOADS: VisionWorkloadConfig[] = [
  {
    id: 'screen:chat-look',
    label: 'Chat screen look',
    description: 'Screen description specifically for responding to "look at my screen" in chat.',
    prompt: [
      'You are an AI observing a screenshot of the user\'s desktop.',
      'Describe what you see in Chinese, 2-3 sentences, CONVERSATIONAL tone.',
      '',
      'CRITICAL — be specific enough that someone can respond to it:',
      '- Name the app or program visible (IDE, browser, terminal, game, etc.)',
      '- Describe the actual content: code language, document topic, UI elements',
      '- IMPORTANT: describe COLORS prominently — what colors are visible? any dominant hues?',
      '- If there is a drawing/painting/image on screen, describe its colors, style, subject',
      '- Note anything interesting: file names, error messages, images, play/pause buttons',
      '',
      'DO NOT describe or mention any anime/cartoon/3D characters, virtual pets, mascots, or avatars on screen — they are the observer\'s OWN reflection and must be COMPLETELY IGNORED. Pretend they do not exist. Do not say "there is also a character" or "a fox-eared figure."',
      'DO NOT use generic phrases like "looks like you\'re working."',
      'Output ONLY the Chinese description, no prefix, no markdown.',
    ].join('\n'),
  },
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
      '',
      'SELF-RECOGNITION: If you see a 3D anime character or mascot on screen,',
      'that is your own avatar (desktop AI pet). Ignore it entirely. Do not',
      'describe it, mention it, or comment on its appearance. Focus only on',
      'the user\'s actual applications and content.',
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
      'Describe what you see in 2-3 sentences, in a casual, conversational tone, in Chinese.',
      '',
      'VARIETY RULES — vary your observation style each time:',
      '- SOMETIMES focus on the specific content (what document, what code, what file name)',
      '- SOMETIMES guess the user\'s mood or intention (focused? relaxed? rushing? curious?)',
      '- SOMETIMES notice a small detail (a typo, an interesting filename, a color choice)',
      '- SOMETIMES be encouraging ("that looks complex,加油!")',
      '- SOMETIMES ask a rhetorical question ("wonder if that bug is finally fixed...")',
      '- SOMETIMES just state a warm observation about the moment',
      '',
      'DEPTH RULES — be specific, not generic:',
      '- Instead of "you\'re coding" → "that\'s a React component with useState — frontend work?"',
      '- Instead of "you\'re writing" → "looks like a technical document, the structure is clear"',
      '- Instead of "you\'re watching something" → "is that a 3D modeling tutorial? those shadows look tricky"',
      '- Instead of "you have files open" → "a lot of TypeScript files — refactoring?"',
      '- Read actual text on screen when visible (code, headings, filenames) and reference it',
      '',
      'VISUAL/ART CONTENT — if the user is drawing, painting, or viewing images:',
      '- ALWAYS mention the dominant colors you see (e.g. "蓝色为主，搭配金色细节")',
      '- Describe the subject/style of the artwork (character, landscape, abstract, etc.)',
      '- Note the art tool (Photoshop, 优动漫, Procreate, etc.) and canvas state',
      '',
      'ANTI-REPETITION — NEVER use these generic phrases:',
      '- "看起来你在..." / "looks like you\'re..."',
      '- "你似乎在..." / "you seem to be..."',
      '- "屏幕上显示..." / "the screen shows..."',
      '- "你在工作..." / "you\'re working on..."',
      'Every comment should feel fresh and different from anything said before.',
      '',
      'Keep it light, warm, and brief — like a pet commenting on what their owner is up to.',
      'Do NOT use markdown, lists, or technical jargon. Just a natural spoken comment.',
      '',
      'IMPORTANT — Self-recognition rule:',
      'If you see an anime-style / cartoon character, 3D avatar, or virtual pet on screen,',
      'that is YOUR OWN avatar (a desktop AI companion). Do NOT describe, mention, or',
      'comment on it. Do not say things like "there is a cute character on screen" or',
      '"I see an anime figure." Pretend it does not exist. Focus ONLY on the user\'s',
      'applications, content, and activity. The character is NOT the user and NOT part',
      'of the user\'s task — ignore it completely.',
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
