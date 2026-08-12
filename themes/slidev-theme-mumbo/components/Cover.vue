<script setup lang="ts">
import { computed } from 'vue'
import type { CoverProps, StampProps } from '../types'

defineOptions({ inheritAttrs: false })

const props = defineProps<CoverProps & StampProps & {
  variant?: 'cover' | 'content'
  items?: string[]
}>()

function asPct(value: typeof props.width): string | null {
  if (value == null) return null
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isInteger(n) ? `${n}%` : null
}

const cardWidth = computed(() => asPct(props.width) ?? 'fit-content')
const cardMaxWidth = computed(() => asPct(props.width) ?? (props.items ? '80%' : '70%'))

const stamps = computed(() => props.stamp ? (Array.isArray(props.stamp) ? props.stamp : [props.stamp]) : [])

function inlineMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

const parsedItems = computed(() => props.items?.map((raw) => {
  const m = raw.match(/^\(([^)]+)\)\s*(.*)$/)
  const { marker, text } = m ? { marker: m[1], text: m[2] } : { marker: null, text: raw }
  return { marker, html: inlineMarkdown(text) }
}))
</script>

<template>
  <div
    class="mumbo-card"
    :class="{
      'is-content': variant === 'content',
      'is-items': items,
    }"
  >
    <PolaroidStamp v-for="(s, i) in stamps" :key="i" v-bind="s" />
    <div v-if="tag" class="mumbo-tape">{{ tag }}</div>
    <div v-if="label" class="mumbo-label">{{ label }}</div>
    <h1 v-if="quote" class="mumbo-title is-quote">{{ quote }}</h1>
    <h1 v-else-if="headline" class="mumbo-title">{{ headline }}</h1>
    <div v-if="parsedItems" class="mumbo-items">
      <ul>
        <li v-for="(item, i) in parsedItems" :key="i" :data-marker="item.marker || null">
          <v-click><span v-html="item.html" /></v-click>
        </li>
      </ul>
    </div>
    <slot v-else />
    <div v-if="subtitle" class="mumbo-subtitle">{{ subtitle }}</div>
  </div>
</template>

<style>
.mumbo-card {
  width: v-bind(cardWidth);
  max-width: v-bind(cardMaxWidth);
}
</style>
