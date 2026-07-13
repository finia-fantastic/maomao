<script setup lang="ts">
/**
 * Invisible host component that mounts the "screen watch" loop for the
 * desktop pet.  Renders nothing — only holds an off-DOM `<video>` element
 * and the composable wired to it.
 *
 * This component is placed in the main stage window template. It self-starts
 * when `screenWatchEnabled` is toggled on in settings and tears down cleanly
 * on unmount or toggle-off.
 */
import { ref } from 'vue'

import { useVisionScreenWatch } from '../composables/useVisionScreenWatch'

// Create a video element once, off-DOM — the composable uses it for frame
// capture without polluting the visual tree.
const video = ref(document.createElement('video'))
video.value.muted = true
video.value.autoplay = true
video.value.playsInline = true

useVisionScreenWatch(video)
</script>

<template>
  <!-- Nothing to render -->
  <div :class="['hidden']" />
</template>
