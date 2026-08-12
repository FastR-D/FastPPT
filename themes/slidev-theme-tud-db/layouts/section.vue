<script setup lang="ts">
import { useLogo } from '../scripts/logo'
import mosaic from '../assets/section-mosaic.svg'

useLogo({ ddrg: 'color', footer: true })
</script>

<template>
  <div class="slidev-layout db-cover p-0">
    <!-- blue band: solid fill + vector mosaic -->
    <div class="relative w-full mt-[95px] h-[250px] bg-[#97c6ff] overflow-hidden">
      <img class="absolute h-full scale-[1.01]" :src="mosaic" alt="" />
    </div>

    <!-- white area: title (#) + subtitle (following text) -->
    <div class="db-cover__title relative m-[30px]">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.db-cover__title :deep(h1) {
  @apply text-4xl! font-700 text-[var(--db-heading-blue)];
}
.db-cover__title :deep(p) {
  @apply absolute top-[95px] m-0 text-md;
  /* margin: 16px 0 0; */
  /* font-size: 15px; */
  color: var(--db-text-soft);
}
</style>
