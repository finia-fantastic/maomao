import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { tool } from '@xsai/tool'
import { z } from 'zod'

import { callWebpage } from './webpage-bridge'

// -- LLM Tool --

// The action ids registered by the user's embedded web app. Keep this in sync with the
// SPA's handler; the enum constrains the model to only call actions the SPA implements.
const WEBPAGE_ACTIONS = [
  'chat',
  'stock.quote',
  'stock.kline',
  'design.fetch',
  'design.imageSearch',
  'design.crawlImages',
  'tts',
  'characters.list',
] as const

const webpageParams = z.object({
  action: z.enum(WEBPAGE_ACTIONS).describe('The webpage action to invoke.'),
  params: z.string().describe([
    'A JSON object string of arguments for the chosen action. Exact shapes:',
    'chat -> {"model":"deepseek-chat","messages":[{"role":"user","content":"..."}],"maxTokens":number?,"temperature":number?}  (model defaults to deepseek-chat)',
    'stock.quote -> {"code":"603881"}  (6-digit A-share stock code — the key is "code", NOT "symbol")',
    'stock.kline -> {"code":"603881","days":60}  (days optional, default 60)',
    'design.fetch -> {"url":"https://..."}  (full URL)',
    'design.imageSearch -> {"query":"关键词"}  (search keyword, key is "query")',
    'design.crawlImages -> {"url":"https://..."}  (target page URL)',
    'tts -> {"model":"tts-1","text":"你好","voice":"..."?}  (model defaults to tts-1)',
    'characters.list -> {}  (no arguments)',
  ].join('\n')),
})

async function executeCallWebpage(input: { action: string, params: string }): Promise<string> {
  let params: Record<string, unknown> = {}
  const raw = input.params?.trim()
  if (raw) {
    try {
      params = JSON.parse(raw)
    }
    catch {
      return `参数不是合法 JSON：${input.params}。请传一个 JSON 对象字符串，例如 {"symbol":"AAPL"}。`
    }
  }

  try {
    const result = await callWebpage(input.action, params)
    return `网页动作 "${input.action}" 返回：${JSON.stringify(result)}`
  }
  catch (error) {
    return `调用网页动作 "${input.action}" 失败：${errorMessageFrom(error) ?? '未知错误'}`
  }
}

const tools: Promise<Tool>[] = [
  tool({
    name: 'call_webpage_tool',
    description: [
      'Invoke a tool inside the user\'s embedded web app (a local React app) and get the result back.',
      'Available actions (see the params field for exact argument shapes):',
      '- chat: run the web app\'s own AI chat (params: model, messages[])',
      '- stock.quote: real-time A-share stock quote (params: code — a 6-digit stock code, not a ticker symbol)',
      '- stock.kline: stock K-line/candlestick data (params: code, days?)',
      '- design.fetch: fetch a web page\'s content + images (params: url)',
      '- design.imageSearch: Baidu image search (params: query)',
      '- design.crawlImages: extract images from a given URL (params: url)',
      '- tts: text-to-speech (params: model, text, voice?)',
      '- characters.list: list available characters (no params)',
      'Use this when the user asks for stock info, image search / web image collection, page scraping, or the web app\'s TTS/characters.',
    ].join('\n'),
    execute: executeCallWebpage,
    parameters: webpageParams,
  }),
]

export const webpageTools = async () => Promise.all(tools)
