<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<template>
  <div class="stg-sowhat">
    <strong v-if="label">{{ label }}</strong>
    <slot />
  </div>
</template>
