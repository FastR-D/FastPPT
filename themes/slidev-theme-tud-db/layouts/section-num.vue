<script setup lang="ts">
import { useSlideContext } from '@slidev/client'
import { computed } from 'vue'

import { useLogo } from '../scripts/logo'

useLogo({ ddrg: 'white', tud: true })

// The large glyph in the blue area can be overridden per slide via the `num`
// frontmatter, e.g.
//   layout: section-num
//   num: IV
// By default it is the slide's position in the table of contents: its 1-based
// index among its siblings at its own TOC level. Slides missing from the TOC
// (no title, or `hideInToc`) show no glyph.
const props = defineProps({
  num: { type: [String, Number], default: '' },
})

const { $nav, $page } = useSlideContext()

interface TocEntry { no: number, children: TocEntry[] }

// 1-based index of the slide numbered `no` among its siblings, or 0 if absent
function tocIndexOf(items: TocEntry[], no: number): number {
  for (const [i, item] of items.entries()) {
    if (item.no === no)
      return i + 1
    const nested = tocIndexOf(item.children, no)
    if (nested)
      return nested
  }
  return 0
}

const num = computed(() => {
  if (String(props.num) !== '')
    return props.num
  return tocIndexOf($nav.value?.tocTree ?? [], $page.value) || ''
})
</script>

<template>
  <div class="slidev-layout db-cover p-0">
    <div class="relative w-full h-[345px] bg-[#2f57b2]">
      <!-- glyph is painted using bg-clip to circumvent firefox' font scaling limit -->
      <!-- See https://bugzilla.mozilla.org/show_bug.cgi?id=1677551 -->
      <div
        v-if="num !== ''"
        class="absolute font-700 text-[24rem]/[24rem] pt-8 px-4 bg-white bg-clip-text text-transparent"
      >{{ num }}</div>
    </div>

    <!-- white area: title (#) + subtitle (following text) -->
    <div class="db-cover__title relative m-[30px]">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.db-cover__title :deep(h1) {
  @apply text-4xl! font-700 text-[var(--db-heading-blue)];
}
.db-cover__title :deep(p) {
  @apply absolute top-[95px] m-0 text-md;
  color: var(--db-text-soft);
}
</style>
