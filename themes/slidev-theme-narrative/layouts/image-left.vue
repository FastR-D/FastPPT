<!--
  image-left — a concept anchored to a photo. Photo left, ≤4 short lines right.
  Alternate with image-right so the deck isn't mechanical.
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
    <div class="mono-split__media" :style="mediaStyle" />
    <div class="mono-split__body">
      <slot />
    </div>
  </div>
</template>
