<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { StampProps } from '../types'

const props = defineProps<StampProps & {
  color?: string
  label?: string | number
  icon?: string
  text?: string
  subtext?: string
}>()

const labelIsIcon = computed(() => typeof props.label === 'string' && props.label.includes(':'))
const resolvedIcon = computed(() => props.icon || (labelIsIcon.value ? (props.label as string) : undefined))
const badgeLabel = computed(() => (labelIsIcon.value ? undefined : props.label))
const stamps = computed(() => props.stamp ? (Array.isArray(props.stamp) ? props.stamp : [props.stamp]) : [])
</script>

<template>
  <div
    class="mumbo-cards-item"
    :class="{ 'has-icon-label': !!resolvedIcon }"
    :style="color ? { '--mumbo-card-color': color } : undefined"
    :data-label="badgeLabel"
  >
    <PolaroidStamp v-for="(s, i) in stamps" :key="i" v-bind="s" />
    <Icon v-if="resolvedIcon" :icon="resolvedIcon" class="mumbo-cards-icon" />
    <slot>{{ text }}</slot>
    <div v-if="subtext" class="mumbo-cards-subtext">{{ subtext }}</div>
  </div>
</template>
