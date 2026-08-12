<!--
  cover — title slide, section breaks, mood/transition moments.
  Full-bleed photo via `background:` frontmatter + a scrim for contrast + one line.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { resolveAssetUrl } from '../utils/assets'

const props = defineProps<{ background?: string }>()

const bgStyle = computed(() =>
  props.background
    ? { backgroundImage: `url("${resolveAssetUrl(props.background)}")` }
    : {},
)
</script>

<template>
  <div class="slidev-layout mono-cover">
    <div class="mono-cover__bg" :style="bgStyle" />
    <div class="mono-cover__scrim" />
    <div class="mono-cover__content">
      <slot />
    </div>
  </div>
</template>
