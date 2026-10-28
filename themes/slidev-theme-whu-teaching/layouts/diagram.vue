<script setup lang="ts">
import WhuBody from '../components/WhuBody.vue'
defineProps<{ caption?: string }>()
</script>
<template>
  <WhuBody>
    <header class="whu-header"><slot /></header>
    <div class="whu-diagram-body">
      <figure class="whu-figure">
        <slot name="figure" />
        <figcaption v-if="caption">{{ caption }}</figcaption>
      </figure>
      <aside class="whu-diagram-notes"><slot name="notes" /></aside>
    </div>
  </WhuBody>
</template>
