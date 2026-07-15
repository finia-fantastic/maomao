import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const fetchUrlParams = z.object({
  url: z.string().describe('The full URL to fetch (must include https:// or http://).'),
  purpose: z.string().describe('Why you are fetching this URL (e.g. "user wants to remember this article", "user shared a video link"). Used to decide how to store the content.').optional(),
})

/**
 * Fetches a URL's text content via the Electron main process.
 *
 * The main process strips HTML and returns plain text (max ~50k chars).
 * After receiving the content, you should:
 * 1. Summarize the key points in 1-2 sentences (Chinese preferred if content is Chinese)
 * 2. Ask the user whether to store the summary in long-term memory
 * 3. If the user says yes (or "记住"), the content will be stored
 */
async function executeFetchUrl(input: { url: string, purpose?: string }): Promise<string> {
  const url = input.url?.trim()
  if (!url) {
    return '❌ URL 为空，请提供有效的链接。'
  }

  // Basic URL validation
  let parsed: URL
  try {
    parsed = new URL(url)
  }
  catch {
    return `❌ URL 格式不正确：${url}。请提供完整的链接（包含 https:// 或 http://）。`
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `❌ 不支持的协议：${parsed.protocol}。仅支持 http 和 https 链接。`
  }

  try {
    console.info('[fetchUrl] fetching:', url.slice(0, 100))
    const result = await (window as any).electron.ipcRenderer.invoke('url:fetch', { url })

    if (!result?.ok) {
      return `❌ 获取页面失败：${result?.error ?? '未知错误'}`
    }

    const { title, text, textLength, truncated } = result

    let response = `✅ 已获取页面内容：\n\n📄 **标题**：${title}\n🌐 **链接**：${url}\n📝 **内容长度**：${textLength} 字符`

    if (truncated) {
      response += `（已截断至 ${textLength} 字符）`
    }

    response += `\n\n--- 页面内容 ---\n\n${text}`

    // Add memory storage hint for the LLM
    response += `\n\n---\n💡 **记忆提示**：请根据以上内容总结 1-2 句核心要点（中文优先），然后询问用户是否要存入长期记忆库。如果用户说"记住"或"存下来"，内容将被保存。`

    console.info('[fetchUrl] success:', title, `${textLength} chars`)
    return response
  }
  catch (error) {
    console.error('[fetchUrl] failed:', error)
    return `❌ 获取页面失败：${errorMessageFrom(error) ?? '网络错误'}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'fetch_url',
    description: [
      'Fetch the text content of a web page given its URL.',
      'Use this when the user shares a link (article, video, blog post, etc.)',
      'and wants you to read, summarize, or remember its content.',
      '',
      'After fetching:',
      '1. Read the full content',
      '2. Summarize the core points in 1-2 concise sentences',
      '3. Ask the user: "要把这个总结存入长期记忆吗？"',
      '4. If they confirm, the summary will be stored in long-term memory',
      '',
      'The fetched text is plain text (HTML already stripped).',
      'Videos/PDFs may return limited content — acknowledge that honestly.',
    ].join('\n'),
    execute: executeFetchUrl,
    parameters: fetchUrlParams,
  }),
]

export const fetchUrlTools = async () => Promise.all(tools)
