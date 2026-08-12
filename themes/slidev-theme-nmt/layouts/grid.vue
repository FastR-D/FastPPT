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
  <div class="slidev-layout grid4" :class="props.layoutClass">

    <div>
      <slot/>
    </div>

    <div class="grid-sections">

      <div class="col-span-1 cell" :class="props.class">
        <slot name="tl"/>
      </div>

      <div class="col-span-1 cell" :class="props.class">
        <slot name="tr"/>
      </div>

      <div class="col-span-1 cell" :class="props.class">
        <slot name="bl"/>
      </div>

      <div class="col-span-1 cell" :class="props.class">
        <slot name="br"/>
      </div>
    </div>

  </div>
</template>
