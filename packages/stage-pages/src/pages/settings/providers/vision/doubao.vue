<script setup lang="ts">
import type { RemovableRef } from '@vueuse/core'

import {
  ProviderAdvancedSettings,
  ProviderApiKeyInput,
  ProviderBaseUrlInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  ProviderValidationAlerts,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

/*
 * NOTICE: 火山方舟豆包视觉必须配置三个字段：
 * 1. API Key
 * 2. Base URL (默认 https://ark.cn-beijing.volces.com/api/v3)
 * 3. Endpoint ID (推理接入点 ep-xxxxxx) — 90% 连接失败都因为漏填这个
 */

const providerId = 'vision-doubao'
const providersStore = useProvidersStore()
const visionStore = useVisionStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }
const { activeProvider } = storeToRefs(visionStore)

const apiKey = computed({
  get: () => providers.value[providerId]?.apiKey || '',
  set: (value) => {
    if (!providers.value[providerId]) providers.value[providerId] = {}
    providers.value[providerId].apiKey = value
  },
})

const baseUrl = computed({
  get: () => providers.value[providerId]?.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3',
  set: (value) => {
    if (!providers.value[providerId]) providers.value[providerId] = {}
    providers.value[providerId].baseUrl = value
  },
})

// NOTICE: 火山方舟推理接入点 ID (ep-xxxxxxxxxx)，在控制台「推理接入点」页面获取。
// 必须填写，否则请求 100% 失败。
const endpointId = computed({
  get: () => providers.value[providerId]?.endpointId || '',
  set: (value) => {
    if (!providers.value[providerId]) providers.value[providerId] = {}
    providers.value[providerId].endpointId = value
  },
})

const {
  t,
  router,
  providerMetadata,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  forceValid,
  hasManualValidators,
  isManualTesting,
  manualTestPassed,
  manualTestMessage,
  runManualTest,
} = useProviderValidation(providerId)

function goToModelSelection() {
  activeProvider.value = providerId
  router.push('/settings/modules/vision')
}
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
        :on-reset="handleResetSettings"
      >
        <ProviderApiKeyInput
          v-model="apiKey"
          :provider-name="providerMetadata?.localizedName"
          :placeholder="t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder')"
        />
      </ProviderBasicSettings>

      <ProviderAdvancedSettings :title="t('settings.pages.providers.common.section.advanced.title')">
        <ProviderBaseUrlInput
          v-model="baseUrl"
          placeholder="https://ark.cn-beijing.volces.com/api/v3"
        />

        <!-- NOTICE: Endpoint ID 是火山方舟必填字段 -->
        <div mt-4 flex flex-col gap-2>
          <label text="sm font-medium neutral-700 dark:neutral-300">
            Endpoint ID (推理接入点)
          </label>
          <input
            v-model="endpointId"
            type="text"
            placeholder="ep-20250715xxxxxxxxxx"
            class="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-primary-500 dark:border-neutral-700 dark:bg-neutral-900"
          >
          <p text="xs neutral-500">
            在火山方舟控制台 → 推理接入点 → 复制 ep-xxxxxx
          </p>
        </div>
      </ProviderAdvancedSettings>

      <ProviderValidationAlerts
        :is-valid="isValid"
        :is-validating="isValidating"
        :validation-message="validationMessage"
        :has-manual-validators="hasManualValidators"
        :is-manual-testing="isManualTesting"
        :manual-test-passed="manualTestPassed"
        :manual-test-message="manualTestMessage"
        :on-run-test="runManualTest"
        :on-force-valid="forceValid"
        :on-go-to-model-selection="goToModelSelection"
      />
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
