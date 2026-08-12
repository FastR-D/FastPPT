<script setup>
import BaseLayout from './base.vue'
</script>

<template>
  <BaseLayout>
    <template #main>
      <div class="h-full w-full flex flex-col justify-center">
        <div class="w-full h-[1px] bg-gray-200"></div>

        <div class="w-full h-[300px] bg-primary flex items-center justify-center">
          <div class="text-center px-12">
            <h1 class="text-white text-4xl font-bold tracking-widest leading-tight">
              <slot />
            </h1>
            <div class="mt-4 text-white text-2xl opacity-90 font-light">
              <slot name="subtitle" />
            </div>
          </div>
        </div>

        <div class="w-full h-[1px] bg-gray-200"></div>
      </div>
    </template>
  </BaseLayout>
</template>