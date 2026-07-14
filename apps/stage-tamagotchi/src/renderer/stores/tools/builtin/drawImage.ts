import { generateDoubaoImage } from '@proj-airi/stage-ui/services/doubao-image/generate'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const drawImageParams = z.object({
  prompt: z.string().describe('Image description (Chinese or English). Be detailed.'),
  size: z.string().describe('Image size, e.g. "1024x1024", "1024x768", "768x1024". Default 1024x1024.').optional(),
})

/**
 * Extract the actual drawing description from a raw user phrase.
 * If the LLM passes a raw prompt like "帮我画一只猫", return it as-is.
 * If it wraps the description in quotes or markdown, strip those.
 */
function extractPrompt(raw: string): string {
  return raw
    .replace(/^["'](.+)["']$/, '$1')
    .replace(/^[：:]\s*/, '')
    .trim()
}

const COMPANION_MESSAGES = [
  '这是我画的，送给你~',
  '嘿嘿，画好啦！喜欢吗？',
  '画完啦！希望你能喜欢~',
  '给你画了一幅画，看看怎么样？',
]

function pickCompanionMessage(): string {
  return COMPANION_MESSAGES[Math.floor(Math.random() * COMPANION_MESSAGES.length)]
}

async function executeDrawImage(input: { prompt: string, size?: string }): Promise<string> {
  const providersStore = useProvidersStore()
  const config = (providersStore.providers as any)?.['doubao-seedream'] as Record<string, string> | undefined

  if (!config?.apiKey) {
    return '❌ 画画失败：豆包 API Key 未配置。请在设置里填写。'
  }

  const seedreamEpId = config.seedreamEndpointId
  if (!seedreamEpId) {
    return '❌ 画画失败：Seedream 接入点 ID 未配置。请在豆包 Seedream 画图设置里填写。'
  }

  const prompt = extractPrompt(input.prompt)
  const size = input.size || '1024x1024'
  console.info('[DrawImage] generating:', prompt.slice(0, 80), `size: ${size}`)

  const result = await generateDoubaoImage({
    prompt,
    endpointId: seedreamEpId,
    apiKey: config.apiKey,
    size,
  })

  if (result.error) {
    console.error('[DrawImage] failed:', result.error)
    return `❌ 画画失败：${result.error}`
  }

  const dataUrl = result.b64_json
    ? `data:image/png;base64,${result.b64_json}`
    : result.url

  if (!dataUrl) {
    return '❌ 画画失败：API 未返回图片。'
  }

  console.info('[DrawImage] success')
  const companionMsg = pickCompanionMessage()
  return `${companionMsg}\n![生成图片](${dataUrl})`
}

const tools = [
  tool({
    name: 'draw_image',
    description: 'Generate an illustration or drawing using AI (Doubao Seedream). Call this when you want to draw/paint/create an image for the user. The prompt should describe what to draw in detail.',
    parameters: drawImageParams,
    execute: executeDrawImage,
  }),
]

export const drawImageTools = async () => Promise.all(tools)
