<script setup lang="ts">
defineProps<{ caption?: string; number?: string | number; credit?: string }>()
</script>
<template>
  <div class="whu-table-block">
    <div v-if="caption" class="whu-table-caption">
      <strong v-if="number !== undefined">表 {{ number }} · </strong
      >{{ caption }}
    </div>
    <slot />
    <div v-if="credit" class="whu-credit">{{ credit }}</div>
  </div>
</template>
