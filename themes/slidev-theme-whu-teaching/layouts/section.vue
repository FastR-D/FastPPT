<script setup lang="ts">
import WhuFooter from '../components/WhuFooter.vue'
withDefaults(defineProps<{ chapter?: string }>(), { chapter: '' })
</script>
<template>
  <div class="slidev-layout whu-slide whu-section">
    <div v-if="chapter" class="whu-section-number">{{ chapter }}</div>
    <span class="whu-cover-gold" aria-hidden="true" />
    <slot />
    <WhuFooter inverse />
  </div>
</template>
