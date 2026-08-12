<script setup lang="ts">
const props = defineProps({
  class: { type: String },
})
</script>

<template>
  <div class="slidev-layout quote" :class="props.class">
    <slot />
  </div>
</template>
