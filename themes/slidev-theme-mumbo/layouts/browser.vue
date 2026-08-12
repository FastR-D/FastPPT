<script setup lang="ts">
import { computed } from 'vue'
import type { CoverProps, LayoutBaseProps, StampProps } from '../types'

const props = defineProps<LayoutBaseProps & StampProps & CoverProps & {
  url?: string
  image?: string
  width?: number | string
}>()

const stamps = computed(() => props.stamp ? (Array.isArray(props.stamp) ? props.stamp : [props.stamp]) : [])
</script>

<template>
  <Wrapper v-bind="$props" name="browser">
    <PolaroidStamp v-for="(s, i) in stamps" :key="i" v-bind="s" />
    <div v-if="label || headline || quote || subtitle || tag" class="mumbo-browser-header">
      <div v-if="tag" class="mumbo-tape">{{ tag }}</div>
      <div v-if="label" class="mumbo-label">{{ label }}</div>
      <h1 v-if="quote" class="mumbo-title is-quote">{{ quote }}</h1>
      <h1 v-else-if="headline" class="mumbo-title">{{ headline }}</h1>
      <div v-if="subtitle" class="mumbo-subtitle">{{ subtitle }}</div>
    </div>
    <BrowserWindow :url="url" :image="image" :width="width" />
  </Wrapper>
</template>
