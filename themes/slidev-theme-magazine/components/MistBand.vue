<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<template>
  <div class="mag-mistband">
    <slot />
  </div>
</template>
