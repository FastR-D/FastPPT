<script setup lang="ts">
const props = defineProps<{ color?: string; title?: string }>()
const palette: Record<string, string> = {
  yellow: 'var(--raft-yellow)',
  pink: 'var(--raft-pink)',
  lavender: 'var(--raft-lavender)',
  cyan: 'var(--raft-cyan)',
  orange: 'var(--raft-orange)',
  lime: 'var(--raft-lime)',
  red: 'var(--raft-red)',
}
const background = palette[props.color ?? 'yellow'] ?? props.color
</script>

<template>
  <div class="raft-callout" :style="{ background }">
    <div v-if="props.title" class="raft-callout-title">{{ props.title }}</div>
    <div class="raft-callout-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.raft-callout {
  border: var(--raft-border);
  box-shadow: var(--raft-shadow);
  padding: 0.8rem 1.1rem;
  margin: 0.8rem 0;
}

.raft-callout-title {
  font-family: 'Space Mono', ui-monospace, monospace;
  font-weight: 700;
  font-size: 0.85rem;
  text-transform: lowercase;
  margin-bottom: 0.3rem;
}

.raft-callout-body :deep(p) {
  margin: 0;
}
</style>
