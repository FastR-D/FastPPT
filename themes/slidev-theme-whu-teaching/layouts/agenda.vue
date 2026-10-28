<script setup lang="ts">
import WhuBody from '../components/WhuBody.vue'
withDefaults(defineProps<{ label?: string }>(), { label: '主要内容' })
</script>
<template>
  <WhuBody>
    <header class="whu-header"><slot /></header>
    <div class="whu-agenda-body">
      <aside class="whu-agenda-label">{{ label }}</aside>
      <div class="whu-agenda-column"><slot name="left" /></div>
      <div class="whu-agenda-column"><slot name="right" /></div>
    </div>
  </WhuBody>
</template>
