<script setup lang="ts">
const props = defineProps<{
  title?: string
  size?: string | number
}>()

const sizeStyle = props.size != null
  ? { '--mumbo-snippet-size': typeof props.size === 'number' ? `${props.size}em` : props.size }
  : undefined
</script>

<template>
  <div class="mumbo-code-window" :style="sizeStyle">
    <div class="mumbo-code-window-bar">
      <span class="mumbo-code-window-dot is-close" />
      <span class="mumbo-code-window-dot is-min" />
      <span class="mumbo-code-window-dot is-max" />
      <span v-if="title" class="mumbo-code-window-title">{{ title }}</span>
    </div>
    <div class="mumbo-code-window-body">
      <slot />
    </div>
  </div>
</template>
