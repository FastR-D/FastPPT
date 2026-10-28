<script setup lang="ts">
withDefaults(defineProps<{ title?: string; kind?: 'note' | 'question' }>(), {
  kind: 'note',
})
</script>
<template>
  <aside class="whu-callout" :class="{ 'is-question': kind === 'question' }">
    <div v-if="title" class="whu-callout-title">{{ title }}</div>
    <slot />
  </aside>
</template>
