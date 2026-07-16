# WiFi 连接状态按钮

右上角显示 WiFi 图标和"已连接/未连接"状态，点击打开连接设置。

## 恢复方法
在 `status-island/index.vue` 中替换注释为：

```html
<div fixed right-3 top-3 z-20>
  <ControlButtonTooltip side="left">
    <ControlButton
      :button-style="buttonStyle.join(' ')"
      :aria-label="tooltipLabel"
      :title="tooltipLabel"
      @click="openSettings({ route: '/settings/connection' })"
    >
      <div :class="iconClasses" :style="flickerStyle" @animationiteration="onAnimationIteration" />
    </ControlButton>
    <template #tooltip>
      {{ tooltipLabel }}
    </template>
  </ControlButtonTooltip>
</div>
```

依赖的变量（`connected`、`buttonStyle`、`iconClasses` 等）没有被删除。
