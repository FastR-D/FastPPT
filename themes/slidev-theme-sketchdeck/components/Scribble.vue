<script setup lang="ts">
/** A hand-written margin annotation. Positions absolutely if given an offset. */
const props = withDefaults(defineProps<{
  color?: 'red' | 'blue' | 'green' | 'yellow' | 'muted' | 'paper'
  tilt?: number | string
  top?: string
  left?: string
  right?: string
  bottom?: string
}>(), { color: 'red', tilt: -6 })

const inks: Record<string, string> = {
  red: 'var(--sk-red)',
  blue: 'var(--sk-blue)',
  green: 'var(--sk-green)',
  yellow: 'var(--sk-yellow)',
  muted: 'var(--sk-ink-muted)',
  paper: 'var(--sk-paper)',
}

const positioned = !!(props.top || props.left || props.right || props.bottom)
</script>

<template>
  <span
    class="sk-scribble"
    :style="{
      color: inks[props.color] || inks.red,
      transform: 'rotate(' + props.tilt + 'deg)',
      position: positioned ? 'absolute' : 'relative',
      top: props.top,
      left: props.left,
      right: props.right,
      bottom: props.bottom,
    }"
  >
    <slot />
  </span>
</template>

<style scoped>
.sk-scribble {
  display: inline-block;
  font-family: 'Caveat', cursive;
  font-size: 2.4rem;
  line-height: 1;
  white-space: nowrap;
  z-index: 5;
}
</style>
