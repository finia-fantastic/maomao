import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../types'
import { createOpenAICompatibleValidators } from '../../validators'
import { defineProvider } from '../registry'

const DOUBAO_MODELS = [
  { id: 'doubao-vision-pro-32k', name: 'doubao-vision-pro-32k' },
  { id: 'doubao-vision-lite-32k', name: 'doubao-vision-lite-32k' },
  { id: 'doubao-pro-32k', name: 'doubao-pro-32k' },
  { id: 'doubao-pro-128k', name: 'doubao-pro-128k' },
  { id: 'doubao-lite-32k', name: 'doubao-lite-32k' },
  { id: 'doubao-lite-128k', name: 'doubao-lite-128k' },
  { id: 'doubao-seed-2-0-mini-260428', name: 'doubao-seed-2-0-mini-260428' },
]

const DOUBAO_MINI_EP_ID = 'ep-20260715012304-n6p8t'

const doubaoConfigSchema = z.object({
  apiKey: z.string('API Key'),
  baseUrl: z.string('Base URL'),
  /** 可选：推理接入点 ID (ep-xxxx)。填了就用 endpoint，不填用模型名。 */
  endpointId: z.string('Endpoint ID').optional(),
})

export const providerDoubao = defineProvider({
  id: 'doubao',
  order: 9,
  name: 'Doubao (Volcengine ARK)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.doubao.title'),
  description: '豆包 (火山方舟) — 支持模型名直连或推理接入点 (ep-xxxx)。',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.doubao.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:volcengine',
  iconColor: 'i-lobe-icons:volcengine',

  createProviderConfig: ({ t }) => doubaoConfigSchema.extend({
    apiKey: doubaoConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: doubaoConfigSchema.shape.baseUrl.default('https://ark.cn-beijing.volces.com/api/v3').meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
    endpointId: doubaoConfigSchema.shape.endpointId.meta({
      label: 'Endpoint ID (可选)',
      description: '推理接入点 ID (ep-xxxx)。留空则使用模型名称直连。',
      placeholder: 'ep-xxxxxxxxxx (可选)',
    }),
  }),

  createProvider(config) {
    const apiKey = (config as any)?.apiKey ?? ''
    const baseUrl = (config as any)?.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3'
    return createOpenAI(apiKey, baseUrl)
  },

  extraMethods: {
    listModels: async (config?: Record<string, unknown>) => {
      const cfg = config as Record<string, unknown> | undefined
      const endpointId = (cfg?.endpointId as string)?.trim()

      // 如果填了 endpoint ID，它作为唯一模型
      if (endpointId) {
        return [{
          id: endpointId,
          name: `Endpoint: ${endpointId}`,
          provider: 'doubao',
        }]
      }

      // 否则返回预定义模型列表
      return DOUBAO_MODELS.map(m => ({
        id: m.id,
        name: m.name,
        provider: 'doubao',
      }))
    },
  },

  validationRequiredWhen(config) {
    const cfg = config as Record<string, unknown> | undefined
    return !!(cfg?.apiKey as string)?.trim()
  },

  // NOTICE: 火山方舟 ARK 没有 /v1/models 端点，不能做 Connectivity check。
  // 只做 ChatCompletions check：用 endpointId 或第一个模型发 ping 请求验证。
  validators: createOpenAICompatibleValidators({
    checks: [ProviderValidationCheck.ChatCompletions],
    normalizeModelId: (modelId) => {
      // 去掉可能的 'Endpoint:' 前缀
      return modelId.replace(/^Endpoint:\s*/, '')
    },
    connectivityFailureReason: () =>
      '火山方舟 ARK 不支持 /models 端点。请直接测试对话功能。',
  }) as any,
})

/**
 * doubao-mini: 豆包 Mini 视觉 (ep-20260715012304-n6p8t)
 * 专用于视觉/对话的推理接入点。与 `doubao` 共享 API Key 和 Base URL。
 */
export const providerDoubaoMini = defineProvider({
  id: 'doubao-mini',
  order: 9,
  name: 'Doubao Mini (豆包 Mini 视觉)',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.doubao-mini.title'),
  description: '豆包 Mini 视觉 — 通过方舟推理接入点使用视觉/对话能力。',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.doubao-mini.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:volcengine',
  iconColor: 'i-lobe-icons:volcengine',

  createProviderConfig: ({ t }) => z.object({
    apiKey: z.string('API Key').meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: z.string('Base URL').default('https://ark.cn-beijing.volces.com/api/v3').meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
    endpointId: z.string('Endpoint ID').default(DOUBAO_MINI_EP_ID).meta({
      label: 'Mini 视觉 Endpoint ID',
      description: '豆包 Mini 视觉推理接入点 ID。已在火山方舟控制台预配。',
      placeholder: DOUBAO_MINI_EP_ID,
    }),
  }),

  createProvider(config) {
    // NOTICE: ARK Seed-2.0-mini uses /responses format, not /chat/completions.
    // Override completions to translate OpenAI ↔ ARK format.
    const apiKey = (config as any)?.apiKey ?? ''
    const baseUrl = (config as any)?.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3'
    const openaiProvider = createOpenAI(apiKey, baseUrl)

    const arkResponsesChat = (model: string) => {
      const originalChat = (openaiProvider as any).chat(model)
      return {
        ...originalChat,
        completions: async (input: any) => {
          const arkMessages = (input.messages || []).map((m: any) => {
            if (typeof m.content === 'string') {
              return { role: m.role, content: [{ type: 'input_text', text: m.content }] }
            }
            if (Array.isArray(m.content)) {
              return {
                role: m.role,
                content: m.content.map((p: any) => {
                  if (p.type === 'text')
                    return { type: 'input_text', text: p.text }
                  if (p.type === 'image_url')
                    return { type: 'input_image', image_url: p.image_url?.url }
                  return p
                }),
              }
            }
            return { role: m.role, content: [{ type: 'input_text', text: String(m.content) }] }
          })

          const resp = await fetch(`${baseUrl}/responses`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model, input: arkMessages }),
            signal: input.signal || AbortSignal.timeout(60_000),
          })

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '')
            throw new Error(`ARK /responses ${resp.status}: ${errText.slice(0, 200)}`)
          }

          const data = await resp.json()
          const outputMsg = data.output?.find?.((o: any) => o?.type === 'message')
          const text = outputMsg?.content
            ?.filter?.((c: any) => c?.type === 'output_text')
            ?.map?.((c: any) => c.text)
            ?.join('') || ''

          return {
            id: data.id || 'ark-response',
            object: 'chat.completion',
            created: Date.now(),
            model,
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          }
        },
      }
    }

    return { ...openaiProvider, chat: arkResponsesChat }
  },

  extraMethods: {
    listModels: async (config?: Record<string, unknown>) => {
      const cfg = config as Record<string, unknown> | undefined
      const endpointId = (cfg?.endpointId as string)?.trim() || DOUBAO_MINI_EP_ID
      return [{
        id: endpointId,
        name: `Endpoint: ${endpointId}`,
        provider: 'doubao-mini',
      }]
    },
  },

  validationRequiredWhen(config) {
    const cfg = config as Record<string, unknown> | undefined
    return !!(cfg?.apiKey as string)?.trim()
  },

  validators: createOpenAICompatibleValidators({
    checks: [ProviderValidationCheck.ChatCompletions],
    normalizeModelId: modelId => modelId.replace(/^Endpoint:\s*/, ''),
    connectivityFailureReason: () =>
      '火山方舟 ARK 不支持 /models 端点。请直接测试对话功能。',
  }) as any,
})

// NOTICE: doubao-seedream (文生图) 已迁移到 Artistry 模块。
// 画图功能通过 useArtistryStore.doubaoSeedreamEndpointId 配置。
