<script setup lang="ts">
import WhuBody from '../components/WhuBody.vue'
</script>
<template>
  <WhuBody>
    <header class="whu-header"><slot /></header>
    <div class="whu-example-body">
      <div><slot name="work" /></div>
      <div><slot name="explanation" /></div>
    </div>
  </WhuBody>
</template>
