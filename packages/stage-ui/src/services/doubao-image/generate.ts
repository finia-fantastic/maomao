/**
 * Doubao Seedream-4.5 image generation service.
 * Calls 火山方舟 ARK images/generations endpoint.
 * Falls back to /responses format if the primary endpoint fails (ARK behavior).
 */

const ARK_IMAGE_API = 'https://ark.cn-beijing.volces.com/api/v3'

interface GenerateImageParams {
  prompt: string
  endpointId: string
  apiKey: string
  size?: string
  n?: number
}

interface GenerateImageResult {
  url?: string
  b64_json?: string
  error?: string
}

/**
 * Try the standard OpenAI-compatible /images/generations endpoint.
 */
async function tryImagesGenerations(params: GenerateImageParams): Promise<GenerateImageResult | null> {
  const { prompt, endpointId, apiKey, size = '1024x1024', n = 1 } = params

  const response = await fetch(`${ARK_IMAGE_API}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: endpointId,
      prompt,
      size,
      n,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    // 如果返回 4xx 表示该接入点不支持 /images/generations 格式
    if (response.status >= 400 && response.status < 500) {
      return null
    }
    return { error: `ARK image API ${response.status}: ${text.slice(0, 200)}` }
  }

  const data = await response.json()
  // OpenAI-compatible format: { data: [{ url, b64_json }] }
  const image = data?.data?.[0]
  if (image?.b64_json) {
    return { b64_json: image.b64_json }
  }
  if (image?.url) {
    return { url: image.url }
  }
  return { error: 'No image data in response' }
}

/**
 * Try the ARK /responses format as fallback.
 * Some Seedream endpoints use the newer responses API.
 */
async function tryResponsesFormat(params: GenerateImageParams): Promise<GenerateImageResult | null> {
  const { prompt, endpointId, apiKey, size = '1024x1024' } = params

  const [width, height] = size.split('x').map(Number)
  const resolution = width && height ? `${width}x${height}` : '1024x1024'

  const response = await fetch(`${ARK_IMAGE_API}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: endpointId,
      input: prompt,
      tools: [{
        type: 'image_generation',
        resolution,
      }],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { error: `ARK /responses API ${response.status}: ${text.slice(0, 200)}` }
  }

  const data = await response.json()
  // responses format: { output: [{ type: 'image', url, b64_json }] }
  const output = data?.output
  if (Array.isArray(output)) {
    const imageItem = output.find((item: any) => item?.type === 'image')
    if (imageItem?.b64_json) {
      return { b64_json: imageItem.b64_json }
    }
    if (imageItem?.url) {
      return { url: imageItem.url }
    }
  }

  // Alternative: { data: [{ url, b64_json }] } from responses
  const image = data?.data?.[0]
  if (image?.b64_json) {
    return { b64_json: image.b64_json }
  }
  if (image?.url) {
    return { url: image.url }
  }

  return { error: 'No image data in /responses output' }
}

/**
 * Generate an image using Doubao Seedream-4.5 via ARK API.
 * Returns the image as a base64 data URL for direct embedding in chat.
 * Tries /images/generations first, falls back to /responses format.
 */
export async function generateDoubaoImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { endpointId, apiKey } = params

  if (!endpointId || !apiKey) {
    return { error: 'Missing endpointId or apiKey' }
  }

  try {
    // Primary: OpenAI-compatible /images/generations
    const primaryResult = await tryImagesGenerations(params)
    if (primaryResult) {
      return primaryResult
    }

    console.info('[DoubaoImage] /images/generations not supported, trying /responses format...')
    // Fallback: ARK /responses format
    const fallbackResult = await tryResponsesFormat(params)
    if (fallbackResult) {
      return fallbackResult
    }

    return { error: 'Both /images/generations and /responses failed' }
  }
  catch (err) {
    return { error: String(err) }
  }
}
