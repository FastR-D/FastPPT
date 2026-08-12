<script setup lang="ts">
import { computed, useAttrs } from 'vue'

interface Props {
    opacity?: number
}

const props = withDefaults(defineProps<Props>(), {
    opacity: 20
})

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
const bgStyle = computed(() => ({ '--whu-bg-opacity': String(props.opacity / 100) }))

</script>

<template>
  <span
    class="inline-block px-3 py-0.5 my-1 rounded-sm transition-all shadow-md border-whu-blue  backdrop-blur-sm" :class="[
      fillWidth ? 'w-full' : 'inline-flex',
      fillHeight ? 'h-full' : '',
    ]" :style="bgStyle">
    <slot />
  </span>
</template>

<style scoped>
span {
    font-family: inherit;
    background-color: rgba(59, 153, 212, var(--whu-bg-opacity, 0.2));
}
</style>