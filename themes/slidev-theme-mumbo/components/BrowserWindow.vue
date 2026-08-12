<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  url?: string
  image?: string
  width?: number | string
}>()

const resolvedImage = computed(() => {
  if (!props.image) return ''
  if (props.image.startsWith('/')) {
    return `${import.meta.env.BASE_URL}${props.image.slice(1)}`
  }
  return props.image
})

const rootStyle = computed(() => {
  if (props.width == null) return undefined
  return { width: typeof props.width === 'number' ? `${props.width}%` : props.width }
})
</script>

<template>
  <div class="mumbo-browser-window" :style="rootStyle">
    <div class="mumbo-browser-bar">
      <span class="mumbo-code-window-dot is-close" />
      <span class="mumbo-code-window-dot is-min" />
      <span class="mumbo-code-window-dot is-max" />
      <div v-if="url" class="mumbo-browser-address">{{ url }}</div>
    </div>
    <div class="mumbo-browser-body">
      <img v-if="resolvedImage" :src="resolvedImage" alt="" />
    </div>
  </div>
</template>
