<script setup lang="ts">
withDefaults(
  defineProps<{
    position?: 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right'
  }>(),
  { position: 'top-left' }
)
</script>

<template>
  <div class="slide-label" :class="`slide-label-${position}`">
    <slot />
  </div>
</template>
