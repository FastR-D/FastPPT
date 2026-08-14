<script setup lang="ts">
defineProps<{ image?: string; role?: string }>()
</script>

<template>
  <div class="slidev-layout mag-cover" :style="image ? { backgroundImage: `url(${image})` } : {}">
    <div class="mag-cover-scrim" />
    <div class="mag-cover-body">
      <span v-if="role" class="mag-role">{{ role }}</span>
      <div class="mag-cover-title"><slot /></div>
      <div class="mag-cover-meta"><slot name="meta" /></div>
    </div>
  </div>
</template>

<style scoped>
.mag-cover {
  position: relative;
  display: flex;
  align-items: flex-end;
  background-size: cover;
  background-position: center;
  color: #ffffff;
}
.mag-cover-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.05) 0%, rgba(0, 0, 0, 0.78) 78%);
}
.mag-cover-body {
  position: relative;
  z-index: 1;
  padding: 3.4rem 4rem;
}
.mag-cover-title :deep(h1) {
  font-family: var(--mag-serif);
  font-size: 3.2rem;
  color: #ffffff;
  margin: 0.4rem 0 0;
}
.mag-cover-title :deep(p) {
  font-size: 1.1rem;
  color: rgba(255, 255, 255, 0.85);
}
.mag-cover-meta {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.7);
}
</style>
