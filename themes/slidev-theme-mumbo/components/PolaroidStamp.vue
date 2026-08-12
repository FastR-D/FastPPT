<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { StampSide } from '../types'

const props = defineProps<{
  url?: string
  emoji?: string
  icon?: string
  color?: string
  position?: StampSide
  inset?: number | string
}>()

const rootStyle = computed(() => {
  if (props.inset == null) return undefined
  const value = typeof props.inset === 'number' ? `${props.inset}px` : props.inset
  return { '--mumbo-stamp-inset': value }
})

const resolvedUrl = computed(() => {
  if (!props.url) return ''
  if (props.url.startsWith('/')) {
    return `${import.meta.env.BASE_URL}${props.url.slice(1)}`
  }
  return props.url
})

const hasContent = computed(() => Boolean(props.url || props.emoji || props.icon))
</script>

<template>
  <div v-if="hasContent" :class="['mumbo-polaroid size-28', position || 'tr']" :style="rootStyle">
    <div class="mumbo-polaroid-frame" />
    <img v-if="url" class="mumbo-polaroid-logo" :src="resolvedUrl" alt="" />
    <Icon v-else-if="icon" class="mumbo-polaroid-icon" :icon="icon" :style="color ? { color } : undefined" />
    <span v-else-if="emoji" class="mumbo-polaroid-emoji" :style="color ? { color } : undefined">{{ emoji }}</span>
  </div>
</template>
