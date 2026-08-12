<script setup lang="ts">
const props = withDefaults(defineProps<{
  color?: 'yellow' | 'blue' | 'green' | 'red'
  tilt?: number | string
}>(), { color: 'yellow', tilt: -1.5 })

const fills: Record<string, string> = {
  yellow: 'var(--sk-paper-warm)',
  blue: 'var(--sk-blue-bg)',
  green: 'var(--sk-green-bg)',
  red: 'var(--sk-red-bg)',
}
</script>

<template>
  <span
    class="sk-sticky"
    :style="{
      background: fills[props.color] || fills.yellow,
      transform: 'rotate(' + props.tilt + 'deg)',
    }"
  >
    <slot />
  </span>
</template>

<style scoped>
.sk-sticky {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72em;
  padding: 0.5em 0.9em;
  border: var(--sk-stroke) solid var(--sk-ink);
  border-radius: var(--sk-wobble-a);
  box-shadow: var(--sk-shadow);
}
</style>
