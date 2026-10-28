<script setup lang="ts">
import WhuFooter from '../components/WhuFooter.vue'
</script>
<template>
  <div class="slidev-layout whu-slide whu-end">
    <div class="whu-top-mark" aria-hidden="true" />
    <span class="whu-cover-gold" aria-hidden="true" />
    <slot />
    <WhuFooter />
  </div>
</template>
