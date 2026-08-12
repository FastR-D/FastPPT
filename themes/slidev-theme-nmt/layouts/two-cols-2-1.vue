<script setup lang="ts">
const props = defineProps({
  class: {
    type: String,
  },
  layoutClass: {
    type: String,
  },
});
</script>

<template>
  <div
      class="slidev-layout two-one"
      :class="props.layoutClass"
  >
    <div class="two-col-full" :class="props.class">
      <slot/>
    </div>

    <div class="two-col-left" :class="props.class">
      <slot name="left"/>
    </div>

    <div class="col-span-1 two-col-right" :class="props.class">
      <slot name="right"/>
    </div>
  </div>
</template>
