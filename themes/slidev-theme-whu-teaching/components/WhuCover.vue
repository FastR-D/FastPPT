<script setup lang="ts">
import campus from '../assets/campus.jpeg'
import instituteLogo from '../assets/institute-logo.png'
import WhuFooter from './WhuFooter.vue'
withDefaults(
  defineProps<{ background?: string; logo?: string; showLogo?: boolean }>(),
  { showLogo: true },
)
</script>
<template>
  <div class="slidev-layout whu-slide whu-cover">
    <img class="whu-cover-photo" :src="background || campus" alt="" />
    <div class="whu-cover-overlay" aria-hidden="true" />
    <img
      v-if="showLogo"
      class="whu-cover-logo"
      :src="logo || instituteLogo"
      alt="武汉数学与智能研究院"
    />
    <div class="whu-cover-rail" aria-hidden="true" />
    <div class="whu-cover-title-mark" aria-hidden="true" />
    <div class="whu-cover-content"><slot /></div>
    <WhuFooter inverse />
  </div>
</template>
