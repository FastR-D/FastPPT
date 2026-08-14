<script setup lang="ts">
defineProps<{ value?: string }>()
</script>

<template>
  <span class="mag-goldbadge">{{ value }}<slot /></span>
</template>
