<script setup lang="ts">
import WhuBody from '../components/WhuBody.vue'
</script>
<template>
  <WhuBody>
    <header class="whu-header"><slot /></header>
    <div class="whu-columns">
      <div class="whu-column"><slot name="left" /></div>
      <div class="whu-column"><slot name="right" /></div>
    </div>
  </WhuBody>
</template>
