<script setup lang="ts">
import ContentFlex from './content-flex.vue'
</script>

<template>
  <ContentFlex v-bind="$attrs">
    <slot />
  </ContentFlex>
</template>
