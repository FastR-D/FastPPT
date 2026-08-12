<script setup lang="ts">
import BaseLayout from './base.vue'


defineProps({
    chapter: { type: String, default: '' },
    section: { type: String, default: '' },
})

</script>

<template>
  <BaseLayout>
    <template #header>
      <div class="flex items-stretch h-full w-full border-primary">
        <div
          class="bg-primary text-white flex items-center justify-center px-8 font-bold text-xl min-w-[150px]">
          {{ chapter }}
        </div>
        <div class="flex-grow flex items-center px-6 text-black font-bold text-xl">
          {{ section }}
        </div>
      </div>
    </template>

    <template #main>
      <div class="p-4 w-full h-full flex flex-col overflow-hidden layout-main">
        <div class="flex-1 min-h-0 overflow-hidden">
          <slot />
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex flex-col w-full">
        <div class="px-2 py-1">
          <References />
        </div>
      </div>
    </template>
  </BaseLayout>
</template>

<style scoped>
.layout-main :deep(img) {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
    margin: 0 auto;
    /* 居中 */
}

.layout-main :deep(p) {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
}

.layout-main :deep(.flex-1) {
    min-height: 0;
}
</style>
