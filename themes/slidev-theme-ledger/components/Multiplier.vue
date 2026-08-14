<script setup lang="ts">
defineProps<{ value?: string }>()
</script>

<template>
  <span class="led-multiplier">{{ value }}<slot /></span>
</template>
