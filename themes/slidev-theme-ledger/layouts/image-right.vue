<script setup lang="ts">
defineProps<{ image?: string }>()
</script>

<template>
  <div class="slidev-layout led-image-right">
    <div class="led-toprule" />
    <div class="led-image-right-grid">
      <div class="text"><slot /></div>
      <div v-if="image" class="media" :style="{ backgroundImage: `url(${image})` }" />
    </div>
  </div>
</template>

<style scoped>
.led-image-right {
  display: flex;
  flex-direction: column;
}
.led-image-right-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 1.8rem;
  align-items: center;
}
.media {
  height: 100%;
  background-size: cover;
  background-position: center;
  border-top: 2px solid var(--led-ink);
  border-bottom: 2px solid var(--led-ink);
}
</style>
