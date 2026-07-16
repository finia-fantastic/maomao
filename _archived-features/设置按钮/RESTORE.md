# 设置按钮

原位置: `controls-island/index.vue` 工具栏第一行

## 恢复方法
在 controls-island/index.vue 中找到注释 `<!-- Settings button archived -->`，替换为：

```html
<ControlButtonTooltip disable-hoverable-content>
  <ControlButton :button-style="adjustStyleClasses.button" @click="openSettings({ route: '/settings' })">
    <div i-solar:settings-minimalistic-outline :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
  </ControlButton>
  <template #tooltip>
    {{ t('tamagotchi.stage.controls-island.open-settings') }}
  </template>
</ControlButtonTooltip>
```

`openSettings` 函数和 `useSettings` 导入没有被删除，恢复按钮即可。
