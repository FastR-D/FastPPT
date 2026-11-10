<script setup lang="ts">
import { fastpptIconUrl } from './brand.js'
import { Image } from '@fastrd/ui-vue'
</script>

<template>
  <Image :src="fastpptIconUrl" class="fp-brand-mark" width="28" height="28" alt="" aria-hidden="true" />
</template>

<style scoped>
.fp-brand-mark {
  display: block;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  object-fit: contain;
}
</style>
