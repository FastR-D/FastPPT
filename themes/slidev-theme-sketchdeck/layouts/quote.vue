<script setup lang="ts">
defineProps<{ source?: string }>()
</script>

<template>
  <div class="slidev-layout plain-paper sk-quote">
    <div class="sk-mark">&ldquo;</div>
    <slot />
    <div v-if="source" class="sk-source">
      <span class="sk-source-rule"></span>
      <span>{{ source }}</span>
    </div>
  </div>
</template>

<style scoped>
.sk-quote {
  background: var(--sk-paper-warm);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 2rem;
  padding: 7% 12%;
}

.sk-mark {
  font-family: 'Caveat', cursive;
  font-size: 10rem;
  line-height: 0.4;
  color: var(--sk-yellow);
}

.sk-quote :deep(blockquote),
.sk-quote :deep(p) {
  font-family: 'Caveat', cursive;
  font-weight: 600;
  font-size: 4.6rem;
  line-height: 1.15;
  max-width: 30ch;
  margin: 0;
}

.sk-source {
  display: flex;
  align-items: center;
  gap: 0.8em;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.3rem;
  color: #6b6558;
}

.sk-source-rule {
  width: 64px;
  height: 3px;
  background: var(--sk-ink);
}
</style>
