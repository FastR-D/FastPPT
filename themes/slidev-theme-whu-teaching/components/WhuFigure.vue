<script setup lang="ts">
defineProps<{
  src?: string
  alt?: string
  caption?: string
  credit?: string
  number?: string | number
}>()
</script>
<template>
  <figure class="whu-figure-block">
    <img v-if="src" :src="src" :alt="alt || caption || ''" />
    <slot v-else />
    <figcaption v-if="caption">
      <strong v-if="number !== undefined">图 {{ number }} · </strong
      >{{ caption }}
    </figcaption>
    <div v-if="credit" class="whu-credit">{{ credit }}</div>
  </figure>
</template>
