<script setup lang="ts">
defineProps<{ eyebrow?: string }>()
</script>

<template>
  <div class="slidev-layout sk-cover">
    <div class="sk-cover-text">
      <div v-if="eyebrow" class="sk-eyebrow">
        <span class="sk-eyebrow-dot"></span>
        <span>{{ eyebrow }}</span>
      </div>
      <slot />
    </div>
    <div class="sk-cover-sketch">
      <slot name="sketch">
        <SketchPlaceholder label="[ whiteboard sketch ]" :tilt="1.6" />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.sk-cover {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  align-items: center;
  gap: 4rem;
  position: relative;
}

.sk-cover-text :deep(h1) {
  font-size: 7.2rem;
  line-height: 0.92;
}

.sk-cover-text :deep(p) {
  font-size: 1.9rem;
  line-height: 1.5;
  max-width: 26ch;
  color: var(--sk-ink-soft);
}

.sk-cover-sketch {
  justify-self: center;
  width: 100%;
  aspect-ratio: 1;
  max-width: 30rem;
}

.sk-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.6em;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.2rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--sk-ink-muted);
  margin-bottom: 1.2em;
}

.sk-eyebrow-dot {
  width: 20px;
  height: 20px;
  border: 3px solid var(--sk-red);
  border-radius: 50%;
}
</style>
