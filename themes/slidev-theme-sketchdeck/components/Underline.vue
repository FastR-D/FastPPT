<script setup lang="ts">
const props = withDefaults(defineProps<{
  color?: 'yellow' | 'red' | 'blue' | 'green'
  width?: string
  tilt?: number | string
}>(), { color: 'yellow', width: '20rem', tilt: -0.8 })

const fills: Record<string, string> = {
  yellow: 'var(--sk-yellow-bg)',
  red: 'var(--sk-red-bg)',
  blue: '#a5d8ff',
  green: 'var(--sk-green-bg)',
}
</script>

<template>
  <div
    class="sk-underline"
    :style="{
      background: fills[props.color] || fills.yellow,
      width: props.width,
      transform: 'rotate(' + props.tilt + 'deg)',
    }"
  ></div>
</template>

<style scoped>
.sk-underline {
  height: 11px;
  border-radius: var(--sk-wobble-a);
}
</style>
