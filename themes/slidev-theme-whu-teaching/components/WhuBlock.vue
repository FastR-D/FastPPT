<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <section class="whu-block">
    <div v-if="title" class="whu-block-title">{{ title }}</div>
    <div class="whu-block-body"><slot /></div>
  </section>
</template>
