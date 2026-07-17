import { generateDoubaoImage } from '@proj-airi/stage-ui/services/doubao-image/generate'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
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
  const artistryStore = useArtistryStore()

  const apiKey = artistryStore.doubaoSeedreamApiKey
  const endpointId = artistryStore.doubaoSeedreamEndpointId
  const defaultSize = artistryStore.doubaoSeedreamSize || '1024x1024'

  if (!apiKey) {
    return '❌ 画画失败：API Key 未配置。请在 Artistry 设置里填写。'
  }

  if (!endpointId) {
    return '❌ 画画失败：Seedream 接入点 ID 未配置。请在 Artistry 设置里填写。'
  }

  const prompt = extractPrompt(input.prompt)
  const size = input.size || defaultSize
  console.info('[DrawImage] generating:', prompt.slice(0, 80), `size: ${size}`)

  const result = await generateDoubaoImage({
    prompt,
    endpointId,
    apiKey,
    size,
  })

  if (result.error) {
    console.error('[DrawImage] failed:', result.error)
    return `❌ 画画失败：${result.error}`
  }

  let imageUrl: string | undefined
  if (result.b64_json) {
    // Save to temp file via IPC to avoid CSP blocking data: URLs
    try {
      const saved = await (window as any).electron.ipcRenderer.invoke('image:save-temp', {
        base64: result.b64_json,
        name: `airi-drawing-${Date.now()}.png`,
      })
      if (saved?.fileUrl) imageUrl = saved.fileUrl
    }
    catch { /* fall through */ }
  }
  if (!imageUrl && result.url) {
    imageUrl = result.url
  }
  if (!imageUrl) {
    return '❌ 画画失败：API 未返回图片。'
  }

  console.info('[DrawImage] success, url:', imageUrl.slice(0, 60))

  // Save to desktop too for easy drag-and-drop into art apps
  let desktopPath = ''
  try {
    const saved = await (window as any).electron.ipcRenderer.invoke('image:save-to-desktop', {
      base64: result.b64_json,
      name: `AI画作-${Date.now()}.png`,
    })
    if (saved?.filePath) desktopPath = saved.filePath
  }
  catch { /* nice-to-have */ }

  const companionMsg = pickCompanionMessage()
  let rsp = `${companionMsg}\n\n<img src="${imageUrl}" alt="AI生成图片" style="max-width:100%;border-radius:12px" />`
  if (desktopPath) rsp += `\n\n已保存到桌面AI画作文件夹，可直接拖进优动漫`
  return rsp
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
