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

const doubaoConfigSchema = z.object({
  apiKey: z.string('API Key'),
  baseUrl: z.string('Base URL'),
  /** 可选：推理接入点 ID (ep-xxxx)。填了就用 endpoint，不填用模型名。 */
  endpointId: z.string('Endpoint ID').optional(),
  /** 文生图接入点 ID (Seedream-4.5)。 */
  seedreamEndpointId: z.string('Seedream Endpoint ID').optional(),
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
    seedreamEndpointId: doubaoConfigSchema.shape.seedreamEndpointId.meta({
      label: 'Seedream 画图 Endpoint ID',
      description: '文生图模型接入点 (ep-xxxx)。猫猫画画时调用此模型生成图片。',
      placeholder: 'ep-xxxxxxxxxx (Seedream-4.5)',
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
