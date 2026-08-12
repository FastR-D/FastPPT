<script setup lang="ts">
const props = defineProps<{ color?: string }>()
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
  <div class="slidev-layout raft-section" :style="{ background }">
    <div class="raft-section-card">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.raft-section {
  display: flex;
  align-items: center;
}

.raft-section-card {
  background: var(--raft-white);
  border: var(--raft-border);
  box-shadow: var(--raft-shadow-lg);
  padding: 1.6rem 2.2rem;
  max-width: 70%;
}

.raft-section-card :deep(h1) {
  font-size: 2.6rem;
  margin: 0;
}

.raft-section-card :deep(p) {
  font-family: 'Space Mono', ui-monospace, monospace;
  margin: 0.5rem 0 0;
}
</style>
