# 暗色模式切换按钮

原位置: `controls-island/index.vue` 的工具栏按钮

## 恢复方法
在 `apps/stage-tamagotchi/src/renderer/components/stage-islands/controls-island/index.vue` 中找到被替换的 inline chat 按钮位置，替换回暗色模式切换代码：

```html
<ControlButtonTooltip disable-hoverable-content>
  <ControlButton :button-style="adjustStyleClasses.button" @click="toggleDark()">
    <Transition name="fade" mode="out-in">
      <div v-if="isDark" i-solar:moon-outline :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
      <div v-else i-solar:sun-2-outline :class="adjustStyleClasses.icon" text="neutral-800 dark:neutral-300" />
    </Transition>
  </ControlButton>
  <template #tooltip>
    {{ isDark ? t('tamagotchi.stage.controls-island.switch-to-light-mode') : t('tamagotchi.stage.controls-island.switch-to-dark-mode') }}
  </template>
</ControlButtonTooltip>
```

暗色模式功能本身（`isDark` 状态、`toggleDark` 函数）没有被删除，只是按钮被替换了。
