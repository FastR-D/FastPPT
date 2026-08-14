<script setup lang="ts">
defineProps<{ image?: string }>()
</script>

<template>
  <div
    class="slidev-layout mag-narrative"
    :style="image ? { backgroundImage: `url(${image})` } : {}"
  >
    <div class="mag-narrative-scrim" />
    <div class="mag-narrative-bands">
      <div class="mag-narrative-band"><slot name="band-1" /><slot /></div>
      <div class="mag-narrative-band"><slot name="band-2" /></div>
      <div class="mag-narrative-band"><slot name="band-3" /></div>
    </div>
  </div>
</template>

<style scoped>
.mag-narrative {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  background-size: cover;
  background-position: center;
}
.mag-narrative-scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, rgba(0, 0, 0, 0.45) 20%, rgba(0, 0, 0, 0.1) 65%, rgba(0, 0, 0, 0.55) 100%);
}
.mag-narrative-bands {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  max-width: 62%;
  padding: 2.6rem 3.2rem;
}
.mag-narrative-band :deep(*) {
  background: rgba(255, 255, 255, 0.88);
  padding: 0.9rem 1.3rem;
  color: var(--mag-ink);
}
</style>
