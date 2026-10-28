<script setup lang="ts">
defineProps<{ number: string | number; title: string }>()
</script>
<template>
  <div class="whu-step">
    <span class="whu-step-number">{{ String(number).padStart(2, '0') }}</span>
    <div>
      <div class="whu-step-title">{{ title }}</div>
      <slot />
    </div>
  </div>
</template>
