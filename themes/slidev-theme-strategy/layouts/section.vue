<script setup lang="ts">
defineProps<{ image?: string; code?: string }>()
</script>

<template>
  <div class="slidev-layout stg-section">
    <div v-if="image" class="stg-section-photo" :style="{ backgroundImage: `url(${image})` }">
      <div class="stg-section-overlay" />
    </div>
    <div class="stg-section-body">
      <span v-if="code" class="stg-pill">{{ code }}</span>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stg-section {
  display: flex;
  align-items: center;
  gap: 2.4rem;
  padding: 3rem 4rem;
}
.stg-section-photo {
  flex: 0 0 38%;
  height: 100%;
  background-size: cover;
  background-position: center;
  position: relative;
}
.stg-section-overlay {
  position: absolute;
  inset: 0;
  background: var(--stg-mint);
  opacity: 0.55;
  mix-blend-mode: multiply;
}
.stg-section-body {
  flex: 1;
}
.stg-section-body :deep(h1) {
  font-size: 2.8rem;
  margin: 0.5rem 0 0;
}
.stg-section-body :deep(p) {
  font-size: 1.05rem;
}
</style>
