<script setup lang="ts">
const props = withDefaults(defineProps<{
  value?: string | number
  color?: 'red' | 'blue' | 'green' | 'yellow'
  wobble?: 'a' | 'b' | 'c' | 'd'
  tilt?: number | string
}>(), { color: 'red', wobble: 'a', tilt: -1 })

const inks: Record<string, string> = {
  red: 'var(--sk-red)',
  blue: 'var(--sk-blue)',
  green: 'var(--sk-green)',
  yellow: 'var(--sk-yellow)',
}
</script>

<template>
  <div
    class="sk-stat"
    :style="{
      borderRadius: 'var(--sk-wobble-' + props.wobble + ')',
      transform: 'rotate(' + props.tilt + 'deg)',
    }"
  >
    <div class="sk-stat-value" :style="{ color: inks[props.color] || inks.red }">
      <slot name="value">{{ props.value }}</slot>
    </div>
    <div class="sk-stat-label"><slot /></div>
  </div>
</template>

<style scoped>
.sk-stat {
  background: #fff;
  border: var(--sk-stroke) solid var(--sk-ink);
  box-shadow: 5px 6px 0 rgba(30, 30, 30, 0.08);
  padding: 1.4em 1.2em;
  display: flex;
  flex-direction: column;
  gap: 0.4em;
}

.sk-stat-value {
  font-family: 'Caveat', cursive;
  font-weight: 700;
  font-size: 5.5rem;
  line-height: 0.9;
}

.sk-stat-label {
  font-size: 1.35rem;
  line-height: 1.4;
}
</style>
