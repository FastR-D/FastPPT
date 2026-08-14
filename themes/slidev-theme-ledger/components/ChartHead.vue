<script setup lang="ts">
defineProps<{ no?: string; title?: string; basis?: string }>()
</script>

<template>
  <div class="led-charthead">
    <span v-if="no" class="no">{{ no }}</span>
    <span v-if="title" class="title">{{ title }}</span>
    <span v-if="basis" class="basis">{{ basis }}</span>
    <slot />
  </div>
</template>
