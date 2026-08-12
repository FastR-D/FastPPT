<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'blue' | 'amber'
  }>(),
  {
    variant: 'primary',
  }
)
</script>

<template>
  <mark
    class="theme-highlight"
    :class="`theme-highlight--${variant === 'blue' ? 'primary' : variant}`"
  >
    <slot />
  </mark>
</template>
