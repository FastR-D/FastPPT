<script setup lang="ts">
import { computed, unref } from 'vue'
import { useSlideContext } from '@slidev/client'
import { sections, activeSection } from '../utils/teaching.mjs'
const { $slidev, $page, $frontmatter } = useSlideContext()
const groups = computed(() => sections($slidev.nav.slides))
const active = computed(() => activeSection(groups.value, unref($page)))
const mode = computed(
  () =>
    unref($frontmatter).sectionBarMode ??
    $slidev.configs.sectionBarMode ??
    'full',
)
</script>
<template>
  <nav
    class="whu-section-bar"
    :class="{ 'is-minimal': mode === 'minimal' }"
    aria-label="课程章节"
  >
    <button
      v-for="(group, i) in groups"
      :key="group.page"
      type="button"
      :class="{ 'is-active': i === active, 'is-complete': i < active }"
      :aria-current="i === active ? 'step' : undefined"
      :aria-label="group.title"
      @click="$slidev.nav.go(group.page)"
    >
      <span class="whu-nav-index">{{ String(i + 1).padStart(2, '0') }}</span>
      <span v-if="mode !== 'minimal'">{{ group.title }}</span>
    </button>
  </nav>
</template>
