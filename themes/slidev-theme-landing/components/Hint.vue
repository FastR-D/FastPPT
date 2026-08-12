<script setup lang="ts">
import { computed, useAttrs } from 'vue'

interface Props {
  title?: string
  icon?: string
  align?: 'left' | 'center' | 'right'
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), {
  align: 'center',
  size: 'md',
})

const containerAlignMap = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
}

const contentAlignMap = {
  left: 'justify-start text-left',
  center: 'justify-center text-center',
  right: 'justify-end text-right',
}
const sizeMap = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}

const attrs = useAttrs()

function classToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(classToString).join(' ')
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => !!enabled)
      .map(([name]) => name)
      .join(' ')
  }
  return ''
}

const mergedClass = computed(() => classToString(attrs.class))
const fillWidth = computed(() => /(^|\s)w-full(\s|$)/.test(mergedClass.value))
const fillHeight = computed(() => /(^|\s)h-full(\s|$)/.test(mergedClass.value))
</script>

<template>
  <div class="whu-hint" :class="containerAlignMap[props.align]">
    <div
      class="whu-hint-panel bg-gray-100/50 rounded-xl border border-whu-sky shadow-md backdrop-blur-sm"
      :class="[
        contentAlignMap[props.align],
        fillWidth ? 'w-full' : 'inline-flex',
        fillHeight ? 'h-full' : '',
      ]"
    >
      <div
        v-if="props.icon"
        :class="props.icon"
        class="whu-hint-icon text-primary shrink-0"
      />

      <div class="whu-hint-content" :class="sizeMap[props.size]">
        <span
          v-if="props.title"
          class="whu-hint-title font-bold text-primary whitespace-nowrap"
        >
          {{ props.title }}
        </span>

        <span v-if="props.title" class="whu-hint-divider bg-gray-300" />

        <div class="whu-hint-body">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.whu-hint {
  display: flex;
  min-height: 2rem;
}

.whu-hint-panel,
.whu-hint-content {
  display: flex;
  align-items: center;
}

.whu-hint-panel {
  gap: 0.5rem;
  min-height: 2rem;
  padding: 0.3rem 0.75rem;
}

.whu-hint-content {
  gap: 0.5rem;
  min-width: 0;
  flex: 1 1 auto;
  line-height: 1.25;
}

.whu-hint-icon {
  display: block;
  width: 1em;
  height: 1em;
}

.whu-hint-title,
.whu-hint-body {
  display: block;
  line-height: 1.25;
}

.whu-hint-body {
  min-width: 0;
}

.whu-hint-divider {
  display: block;
  width: 1px;
  height: 0.9em;
  flex: none;
}

.whu-hint-body :deep(p) {
  margin: 0;
  line-height: inherit;
}
</style>
