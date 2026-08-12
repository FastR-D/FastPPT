<script setup lang="ts">
const props = defineProps({
  class: { type: String },
})
</script>

<template>
  <div class="slidev-layout cover" :class="props.class">
    <div class="my-auto w-full">
      <slot />
    </div>
    <div class="cover-accent" />
  </div>
</template>

<style scoped>
.cover-accent {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 6px;
  background: var(--slidev-theme-primary);
}
</style>
