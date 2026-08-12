<script setup lang="ts">
const props = withDefaults(defineProps<{
  /** background fill */
  color?: 'paper' | 'warm' | 'shaded' | 'red' | 'blue' | 'green'
  /** which wobbly border radius to use */
  wobble?: 'a' | 'b' | 'c' | 'd'
  /** degrees of askew */
  tilt?: number | string
  /** drop the offset shadow */
  flat?: boolean
}>(), { color: 'paper', wobble: 'a', tilt: 0, flat: false })

const fills: Record<string, string> = {
  paper: '#fff',
  warm: 'var(--sk-paper-warm)',
  shaded: 'var(--sk-paper-shade)',
  red: 'var(--sk-red-bg)',
  blue: 'var(--sk-blue-bg)',
  green: 'var(--sk-green-bg)',
}
</script>

<template>
  <div
    class="sk-box"
    :style="{
      background: fills[props.color] || fills.paper,
      borderRadius: 'var(--sk-wobble-' + props.wobble + ')',
      transform: 'rotate(' + props.tilt + 'deg)',
      boxShadow: props.flat ? 'none' : 'var(--sk-shadow)',
    }"
  >
    <slot />
  </div>
</template>

<style scoped>
.sk-box {
  border: var(--sk-stroke) solid var(--sk-ink);
  padding: 1.1em 1.3em;
  box-sizing: border-box;
}
</style>
