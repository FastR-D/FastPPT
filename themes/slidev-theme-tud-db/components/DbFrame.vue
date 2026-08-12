<script setup lang="ts">
// `codeSize` (from the slide's frontmatter, passed in by the layout) overrides
// the code font size for this slide. Inline style beats the theme's class rule.
const props = defineProps({
  codeSize: { type: String, default: '' },
})
</script>

<template>
  <div
    class="slidev-layout default db-default relative"
    :style="props.codeSize ? { '--slidev-code-font-size': props.codeSize } : undefined"
  >
    <div class="db-default__body px-[30px] py-[33.5px]">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.db-default__body :deep(h1:first-child) {
  margin-top: 0;
}
</style>
