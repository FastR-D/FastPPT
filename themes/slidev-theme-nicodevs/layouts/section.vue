<script setup lang="ts">
const props = defineProps({
  class: { type: String },
})
</script>

<template>
  <div class="slidev-layout section" :class="props.class">
    <slot />
  </div>
</template>
