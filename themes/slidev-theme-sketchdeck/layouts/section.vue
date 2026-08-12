<script setup lang="ts">
withDefaults(defineProps<{
  part?: string
  accent?: 'red' | 'blue' | 'green' | 'yellow'
}>(), { accent: 'red' })
</script>

<template>
  <div class="slidev-layout sk-dark sk-section">
    <div v-if="part" class="sk-part">{{ part }}</div>
    <slot />
    <Underline :color="accent" width="26rem" :tilt="-1" class="sk-rule" />
  </div>
</template>

<style scoped>
.sk-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 1.2rem;
  position: relative;
}

.sk-section :deep(h1),
.sk-section :deep(h2) {
  font-size: 8.6rem;
  line-height: 0.95;
  margin: 0;
}

.sk-section :deep(p) {
  font-size: 1.75rem;
  max-width: 34ch;
  margin: 0;
}

.sk-part {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.3rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #ffd8a8;
}

.sk-rule {
  order: 3;
}
</style>
