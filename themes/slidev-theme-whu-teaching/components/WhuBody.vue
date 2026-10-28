<script setup lang="ts">
import { computed, unref } from 'vue'
import { useSlideContext } from '@slidev/client'
import { rhythm, sections, columnRatio } from '../utils/teaching.mjs'
import WhuFooter from './WhuFooter.vue'
import WhuSectionBar from './WhuSectionBar.vue'
withDefaults(defineProps<{ variant?: string }>(), { variant: 'whu-structured' })
const { $slidev, $frontmatter } = useSlideContext()
const options = computed(() => rhythm(unref($frontmatter), $slidev.configs))
const navVisible = computed(
  () =>
    (unref($frontmatter).sectionBar ?? $slidev.configs.sectionBar) !== false &&
    sections($slidev.nav.slides).length > 0,
)
const style = computed(() => ({
  '--whu-flow-gap': options.value.flowGap,
  '--whu-leading': options.value.lineHeight,
  '--whu-columns': columnRatio(unref($frontmatter).ratio),
  '--whu-column-gap':
    { sm: '24px', md: '36px', lg: '48px' }[unref($frontmatter).gap as string] ??
    '36px',
}))
</script>
<template>
  <div
    class="slidev-layout whu-slide whu-academic"
    :class="[
      variant,
      'whu-density-' + options.density,
      { 'whu-has-nav': navVisible },
    ]"
    :style="style"
  >
    <WhuSectionBar v-if="navVisible" />
    <div v-else class="whu-top-mark" aria-hidden="true" />
    <slot />
    <WhuFooter />
  </div>
</template>
