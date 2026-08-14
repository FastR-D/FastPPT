<script setup lang="ts">
defineProps<{ image?: string }>()
</script>

<template>
  <div class="slidev-layout mag-image-right">
    <div class="text"><slot /></div>
    <div v-if="image" class="media" :style="{ backgroundImage: `url(${image})` }" />
  </div>
</template>

<style scoped>
.mag-image-right {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 2rem;
  align-items: center;
}
.media {
  height: 100%;
  background-size: cover;
  background-position: center;
}
</style>
