<script setup lang="ts">
defineProps<{ title?: string }>()
</script>
<template>
  <section class="whu-note">
    <div v-if="title" class="whu-note-title">{{ title }}</div>
    <div><slot /></div>
  </section>
</template>
