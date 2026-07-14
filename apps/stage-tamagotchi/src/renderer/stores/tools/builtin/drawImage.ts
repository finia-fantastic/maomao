import { generateDoubaoImage } from '@proj-airi/stage-ui/services/doubao-image/generate'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const drawImageParams = z.object({
  prompt: z.string().describe('Image description (Chinese or English). Be detailed.'),
})

async function executeDrawImage(input: { prompt: string }): Promise<string> {
  const providersStore = useProvidersStore()
  const config = (providersStore.providers as any)?.doubao as Record<string, string> | undefined

  if (!config?.apiKey) {
    return '❌ 画画失败：豆包 API Key 未配置。请在设置里填写。'
  }

  const seedreamEpId = config.seedreamEndpointId || config.endpointId
  if (!seedreamEpId) {
    return '❌ 画画失败：Seedream 接入点 ID 未配置。请在豆包设置里填写。'
  }

  console.log('[DrawImage] generating:', input.prompt.slice(0, 80))

  const result = await generateDoubaoImage({
    prompt: input.prompt,
    endpointId: seedreamEpId,
    apiKey: config.apiKey,
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

  console.log('[DrawImage] success')
  return `✅ 画好了！\n![生成图片](${dataUrl})`
}

const tools = [
  tool({
    name: 'draw_image',
    description: 'Generate an illustration or drawing using AI. Call this when you want to draw/paint/create an image for the user. The prompt should describe what to draw in detail.',
    parameters: drawImageParams,
    execute: executeDrawImage,
  }),
]

export const drawImageTools = async () => Promise.all(tools)
