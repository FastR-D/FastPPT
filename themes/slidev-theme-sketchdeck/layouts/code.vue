<script setup lang="ts">
defineProps<{ file?: string }>()
</script>

<template>
  <div class="slidev-layout sk-code">
    <div class="sk-code-head">
      <slot name="title" />
      <span v-if="file" class="sk-file">{{ file }}</span>
    </div>
    <div class="sk-code-body"><slot /></div>
  </div>
</template>

<style scoped>
.sk-code {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  position: relative;
}

.sk-code-head {
  display: flex;
  align-items: baseline;
  gap: 1.2rem;
}

.sk-code-head :deep(h1),
.sk-code-head :deep(h2) {
  font-size: 3.6rem;
  margin: 0;
}

.sk-file {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.15rem;
  color: var(--sk-ink-muted);
}

.sk-code-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sk-code-body :deep(.slidev-code) {
  flex: 1;
  margin: 0;
}
</style>
