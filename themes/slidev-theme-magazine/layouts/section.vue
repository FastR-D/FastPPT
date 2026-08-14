<script setup lang="ts">
defineProps<{ image?: string; role?: string }>()
</script>

<template>
  <div
    class="slidev-layout mag-section"
    :style="image ? { backgroundImage: `url(${image})` } : {}"
  >
    <div class="mag-section-scrim" />
    <div class="mag-section-body">
      <span v-if="role" class="mag-role">{{ role }}</span>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mag-section {
  position: relative;
  display: flex;
  align-items: center;
  background-size: cover;
  background-position: center;
  color: #ffffff;
}
.mag-section-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, rgba(0, 0, 0, 0.6) 30%, rgba(0, 0, 0, 0.25) 100%);
}
.mag-section-body {
  position: relative;
  z-index: 1;
  padding: 3rem 4rem;
  max-width: 70%;
}
.mag-section-body :deep(h1) {
  font-family: var(--mag-serif);
  font-size: 3rem;
  color: #ffffff;
  margin: 0.5rem 0 0;
}
.mag-section-body :deep(p) {
  font-size: 1.05rem;
  color: rgba(255, 255, 255, 0.85);
}
</style>
