<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { StickerItem } from '../types'

const props = defineProps<{
  items: StickerItem[]
  headline?: string
}>()

const resolved = computed(() => props.items.map((item) => {
  const url = item.url && item.url.startsWith('/')
    ? `${import.meta.env.BASE_URL}${item.url.slice(1)}`
    : item.url
  const icon = item.icon
    || (!item.url && typeof item.text === 'string' && item.text.includes(':') ? item.text : undefined)
  return { ...item, url, icon }
}))

function stickerStyle(item: StickerItem, i: number) {
  const value = item.rotation == null
    ? '0deg'
    : typeof item.rotation === 'number' ? `${item.rotation}deg` : item.rotation
  return {
    '--mumbo-rotate': value,
    animationDelay: `${0.08 + i * 0.06}s`,
  }
}

function stickerClass(item: StickerItem) {
  if (item.url) return 'mumbo-sticker is-image'
  if (item.icon) return 'mumbo-sticker is-icon'
  return 'mumbo-sticker'
}
</script>

<template>
  <div class="mumbo-stickers-section">
    <h1 v-if="headline" class="mumbo-title mumbo-stickers-headline">{{ headline }}</h1>
    <div class="mumbo-stickers-wall">
      <span
        v-for="(item, i) in resolved"
        :key="i"
        :class="stickerClass(item)"
        :style="stickerStyle(item, i)"
      >
        <img v-if="item.url" :src="item.url" alt="" />
        <Icon v-else-if="item.icon" :icon="item.icon" />
        <template v-else>{{ item.text }}</template>
      </span>
    </div>
  </div>
</template>
