<script setup lang="ts">
/** Hatched box standing in for a real diagram. Swap for an <img> when you have one. */
const props = withDefaults(defineProps<{
  label?: string
  wobble?: 'a' | 'b' | 'c' | 'd'
  tilt?: number | string
  /** hatch angle in degrees */
  hatch?: number | string
}>(), { label: '[ sketch goes here ]', wobble: 'a', tilt: 1.2, hatch: 135 })

const hatchFill = 'repeating-linear-gradient(' + props.hatch + 'deg, var(--sk-paper-shade) 0 14px, var(--sk-paper) 14px 28px)'
</script>

<template>
  <div
    class="sk-ph"
    :style="{
      borderRadius: 'var(--sk-wobble-' + props.wobble + ')',
      transform: 'rotate(' + props.tilt + 'deg)',
      backgroundImage: hatchFill,
    }"
  >
    <span class="sk-ph-label"><slot>{{ props.label }}</slot></span>
  </div>
</template>

<style scoped>
.sk-ph {
  width: 100%;
  height: 100%;
  min-height: 12rem;
  border: 3px solid var(--sk-ink);
  box-shadow: var(--sk-shadow-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.sk-ph-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.3rem;
  line-height: 1.7;
  color: #8c8578;
  text-align: center;
}
</style>
