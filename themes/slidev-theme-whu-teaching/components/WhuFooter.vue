<script setup lang="ts">
import { computed, unref } from 'vue'
import { useSlideContext } from '@slidev/client'
withDefaults(defineProps<{ inverse?: boolean }>(), { inverse: false })
const { $page, $slidev, $frontmatter } = useSlideContext()
const enabled = computed(
  () =>
    unref($frontmatter).pageNumber !== false &&
    (unref($frontmatter).footer ?? $slidev.configs.footer) !== false,
)
const label = computed(() =>
  typeof unref($frontmatter).footer === 'string'
    ? unref($frontmatter).footer
    : (unref($frontmatter).courseTitle ?? $slidev.configs.courseTitle ?? ''),
)
const lecturer = computed(
  () =>
    unref($frontmatter).presenterName ?? $slidev.configs.presenterName ?? '',
)
const minimal = computed(
  () =>
    (unref($frontmatter).footerMode ?? $slidev.configs.footerMode) ===
    'minimal',
)
</script>
<template>
  <footer
    v-if="enabled"
    class="whu-footer"
    :class="{ 'is-inverse': inverse, 'is-minimal': minimal }"
  >
    <span class="whu-footer-label">{{ minimal ? '' : label }}</span>
    <span v-if="!minimal" class="whu-footer-lecturer">{{ lecturer }}</span>
    <span class="whu-footer-page"
      >{{ String($page).padStart(2, '0') }} /
      {{ String($slidev.nav.total).padStart(2, '0') }}</span
    >
  </footer>
</template>
