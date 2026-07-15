<script setup lang="ts">
import {
  ProviderAdvancedSettings,
  ProviderApiKeyInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

const router = useRouter()
const artistryStore = useArtistryStore()
const {
  doubaoSeedreamApiKey,
  doubaoSeedreamEndpointId,
  doubaoSeedreamSize,
} = storeToRefs(artistryStore)
</script>

<template>
  <ProviderSettingsLayout
    provider-name="Doubao Seedream"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings title="API 连接" description="火山方舟 Seedream-4.5 文生图">
        <ProviderApiKeyInput
          v-model="doubaoSeedreamApiKey"
          provider-name="Doubao Seedream"
          placeholder="ark-..."
        />
      </ProviderBasicSettings>

      <ProviderAdvancedSettings title="模型配置">
        <div mt-4 flex flex-col gap-2>
          <label text="sm font-medium neutral-700 dark:neutral-300">
            Endpoint ID
          </label>
          <input
            v-model="doubaoSeedreamEndpointId"
            type="text"
            placeholder="ep-..."
            class="w-full border border-neutral-300 rounded-lg bg-white px-3 py-2 text-sm outline-none transition-colors dark:border-neutral-700 focus:border-primary-500 dark:bg-neutral-900"
          >
          <p text="xs neutral-500">
            火山方舟控制台 → 推理接入点 → 复制 ep-xxxxxx
          </p>
        </div>

        <div mt-4 flex flex-col gap-2>
          <label text="sm font-medium neutral-700 dark:neutral-300">
            图片尺寸
          </label>
          <select
            v-model="doubaoSeedreamSize"
            class="w-full border border-neutral-300 rounded-lg bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="1024x1024">1024x1024 (方形)</option>
            <option value="1024x768">1024x768 (横版)</option>
            <option value="768x1024">768x1024 (竖版)</option>
          </select>
        </div>
      </ProviderAdvancedSettings>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
