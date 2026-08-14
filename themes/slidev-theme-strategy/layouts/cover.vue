<script setup lang="ts">
defineProps<{ image?: string; chapter?: string }>()
</script>

<template>
  <div class="slidev-layout stg-cover">
    <div v-if="image" class="stg-cover-photo" :style="{ backgroundImage: `url(${image})` }">
      <div class="stg-cover-darken" />
    </div>
    <div class="stg-cover-body">
      <span v-if="chapter" class="stg-pill">{{ chapter }}</span>
      <div class="stg-cover-title">
        <slot />
      </div>
      <div class="stg-cover-stripe">
        <span class="bar" />
        <span class="ticks" />
      </div>
      <div class="stg-cover-meta"><slot name="meta" /></div>
    </div>
  </div>
</template>

<style scoped>
.stg-cover {
  display: flex;
  align-items: center;
  position: relative;
  overflow: hidden;
  padding: 3.4rem 4rem;
}
.stg-cover-photo {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
}
.stg-cover-darken {
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, rgba(255, 255, 255, 0.9) 30%, rgba(3, 82, 44, 0.55) 90%);
}
.stg-cover-body {
  position: relative;
  z-index: 1;
  max-width: 74%;
}
.stg-cover-title :deep(h1) {
  font-size: 3rem;
  color: var(--stg-green);
  margin: 0.6rem 0 0;
  padding: 0;
  border-bottom: none;
}
.stg-cover-title :deep(h1)::before,
.stg-cover-title :deep(h1)::after {
  content: none;
}
.stg-cover-title :deep(p) {
  font-size: 1.1rem;
  color: var(--stg-text);
}
.stg-cover-stripe {
  display: flex;
  height: 8px;
  margin: 1.6rem 0 1rem;
}
.stg-cover-stripe .bar {
  width: 26%;
  background: var(--stg-green);
}
.stg-cover-stripe .ticks {
  flex: 1;
  background: repeating-linear-gradient(90deg, var(--stg-green) 0 2px, transparent 2px 8px);
}
.stg-cover-meta {
  font-size: 0.85rem;
  color: var(--stg-muted);
}
.stg-cover-meta :deep(p) {
  margin: 0.2rem 0;
}
</style>
