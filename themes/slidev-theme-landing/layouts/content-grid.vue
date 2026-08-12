<script setup lang="ts">
import BaseLayout from './base.vue'


defineProps({
    section: { type: String, default: '' },
    title: { type: String, default: '' },
})

</script>

<template>
  <BaseLayout>
    <template #header>
      <div class="flex items-stretch h-full w-full  border-primary">
        <div class="bg-primary text-white flex items-center px-8 font-bold text-xl min-w-[150px]">
          {{ section }}
        </div>
        <div v-if="title" class="flex-grow flex items-center px-6 text-black font-bold text-xl">
          {{ title }}
        </div>
      </div>
    </template>
    <template #main>
      <main class="flex-grow flex flex-col items-center justify-center">
        <slot />
      </main>
    </template>
  </BaseLayout>
</template>
