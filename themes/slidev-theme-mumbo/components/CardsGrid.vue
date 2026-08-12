<script setup lang="ts">
defineProps<{
  headline?: string
  reveal?: boolean
}>()
</script>

<template>
  <div class="mumbo-cards-section" :class="{ 'is-reveal': reveal }">
    <h1 v-if="headline" class="mumbo-title mumbo-cards-headline">{{ headline }}</h1>
    <div class="mumbo-cards-grid">
      <slot />
    </div>
  </div>
</template>
