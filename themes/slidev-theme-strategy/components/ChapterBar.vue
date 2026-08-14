<script setup lang="ts">
defineProps<{ code?: string; section?: string }>()
</script>

<template>
  <div class="stg-nav">
    <span class="code">{{ code }}</span>
    <span class="rule" />
    <span class="section">{{ section }}</span>
    <slot />
  </div>
</template>
