<script setup lang="ts">
defineProps<{ image?: string }>()
</script>

<template>
  <div class="slidev-layout stg-image-right">
    <div class="stg-image-right-text">
      <slot />
    </div>
    <div v-if="image" class="stg-image-right-media" :style="{ backgroundImage: `url(${image})` }" />
  </div>
</template>

<style scoped>
.stg-image-right {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 1.8rem;
  align-items: center;
}
.stg-image-right-media {
  height: 100%;
  background-size: cover;
  background-position: center;
  border-top: 4px solid var(--stg-green);
  border-bottom: 4px solid var(--stg-green);
}
</style>
