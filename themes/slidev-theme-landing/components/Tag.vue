<script setup lang="ts">
withDefaults(defineProps<{ color?: string }>(), { color: 'var(--whu-tag-color, #f8a3bc)' })
</script>

<template>
  <span class="whu-tag" :style="{ '--whu-tag-accent': color }"><slot /></span>
</template>

<style scoped>
.whu-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 1.45em;
  padding: 0 0.52em;
  border-radius: 999px;
  background: color-mix(in srgb, var(--whu-tag-accent) 22%, transparent);
  color: #002554;
  font-size: 0.82em;
  font-weight: 700;
  line-height: 1;
  vertical-align: 0.04em;
  white-space: nowrap;
}
</style>
