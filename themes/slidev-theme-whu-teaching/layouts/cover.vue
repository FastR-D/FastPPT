<script setup lang="ts">
import WhuCover from '../components/WhuCover.vue'
withDefaults(
  defineProps<{ background?: string; logo?: string; showLogo?: boolean }>(),
  { showLogo: true },
)
</script>
<template>
  <WhuCover :background="background" :logo="logo" :show-logo="showLogo"
    ><slot
  /></WhuCover>
</template>
