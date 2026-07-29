import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

const webSearchParams = z.object({
  query: z.string().describe('Search query (Chinese or English).'),
  maxResults: z.number().min(1).max(10).describe('Max results to return (1-10, default 5).').optional(),
})

interface SearchResult {
  title: string
  url: string
  snippet: string
}

/**
 * Search the web using DuckDuckGo Instant Answer API (free, no API key).
 * Returns titles, URLs, and snippets. Combine with fetch_url to read full articles,
 * and store_memory to save what you learn.
 */
async function executeWebSearch(input: { query: string, maxResults?: number }): Promise<string> {
  const query = input.query?.trim()
  if (!query) return '搜索词为空。'

  const max = Math.min(input.maxResults ?? 5, 10)

  // Try multiple search backends (some APIs are blocked in certain regions)
  const backends = [
    // Backend 1: DuckDuckGo
    async () => {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!resp.ok) return null
      const data = await resp.json()
      const results: SearchResult[] = []
      const topics = data.RelatedTopics || []
      for (const t of topics) {
        if (results.length >= max) break
        if (t.Text && t.FirstURL) {
          results.push({ title: t.Text.split(' - ')[0]?.slice(0, 80) || t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 200) })
        }
      }
      if (results.length === 0 && data.AbstractText) {
        results.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText.slice(0, 200) })
      }
      return results.length > 0 ? results : null
    },
    // Backend 2: Wikipedia (works in most regions)
    async () => {
      const url = `https://zh.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=${max}&format=json&origin=*`
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!resp.ok) return null
      const data = await resp.json()
      const results: SearchResult[] = []
      const titles = data[1] || []
      const snippets = data[2] || []
      const urls = data[3] || []
      for (let i = 0; i < Math.min(titles.length, max); i++) {
        if (titles[i]) {
          results.push({ title: titles[i], url: urls[i] || `https://zh.wikipedia.org/wiki/${encodeURIComponent(titles[i])}`, snippet: snippets[i]?.slice(0, 200) || '' })
        }
      }
      return results.length > 0 ? results : null
    },
  ]

  for (const backend of backends) {
    try {
      const results = await backend()
      if (results && results.length > 0) {
        const lines = results.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.snippet}\n   🔗 ${r.url}`,
        )
        return `搜索"${query}"的结果：\n\n${lines.join('\n\n')}\n\n�' 用 fetch_url 读取感兴趣的页面，用 store_memory 保存重要内容。`
      }
    }
    catch { /* try next backend */ }
  }

  return `搜索"${query}"未找到结果。可能网络受限——试试用 fetch_url 直接打开你感兴趣的网站，或者换个关键词再搜。`
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'web_search',
    description: [
      'Search the web and get results with titles, URLs, and snippets.',
      'Use this when:',
      '- The user asks about something you don\'t know',
      '- You want to find the latest information on a topic',
      '- The user asks you to research or look up something',
      '- You need real-time data or news',
      '',
      'After searching:',
      '1. Pick the most relevant results',
      '2. Use fetch_url to read the full article if needed',
      '3. Summarize what you learned for the user',
      '4. Use store_memory to save important findings',
      '',
      'Always try to search when the user asks about current events, facts, or topics beyond your knowledge.',
    ].join('\n'),
    execute: executeWebSearch,
    parameters: webSearchParams,
  }),
]

export const webSearchTools = async () => Promise.all(tools)
