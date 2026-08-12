<!--
  image-right — mirror of image-left. Photo right, ≤4 short lines left.
  Photo via `image:` frontmatter.
-->
<script setup lang="ts">
import { computed } from 'vue'
import { resolveAssetUrl } from '../utils/assets'

const props = defineProps<{ image?: string }>()

const mediaStyle = computed(() =>
  props.image
    ? { backgroundImage: `url("${resolveAssetUrl(props.image)}")` }
    : {},
)
</script>

<template>
  <div class="slidev-layout mono-split">
    <div class="mono-split__body">
      <slot />
    </div>
    <div class="mono-split__media" :style="mediaStyle" />
  </div>
</template>
