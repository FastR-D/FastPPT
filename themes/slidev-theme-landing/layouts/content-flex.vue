<script setup lang="ts">
import BaseLayout from './base.vue'
import References from '../plugins/references/References.vue'

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
          class="bg-primary text-white flex items-center justify-center px-8 font-bold text-xl min-w-[150px]"
        >
          {{ chapter }}
        </div>
        <div
          class="flex-grow flex items-center px-6 text-black font-bold text-xl"
        >
          {{ section }}
        </div>
      </div>
    </template>

    <template #main>
      <div class="p-4 w-full h-full flex flex-col overflow-hidden">
        <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
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
