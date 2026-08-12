<script setup lang="ts">
const props = defineProps({
  class: { type: String },
})
</script>

<template>
  <div class="slidev-layout end" :class="props.class">
    <slot />
    <div class="end-accent" />
  </div>
</template>

<style scoped>
.end-accent {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 6px;
  background: var(--slidev-theme-primary);
}
</style>
