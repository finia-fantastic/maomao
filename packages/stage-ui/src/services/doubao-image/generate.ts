/**
 * Doubao Seedream-4.5 image generation service.
 * Calls 火山方舟 ARK images/generations endpoint.
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
 * Generate an image using Doubao Seedream-4.5 via ARK API.
 * Returns the image as a base64 data URL for direct embedding in chat.
 */
export async function generateDoubaoImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { prompt, endpointId, apiKey, size = '1024x1024', n = 1 } = params

  if (!endpointId || !apiKey) {
    return { error: 'Missing endpointId or apiKey' }
  }

  try {
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
  catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
