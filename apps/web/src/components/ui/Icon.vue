<script setup lang="ts">
import { Svg, SvgPath } from '@fastrd/ui-vue'
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  moon: 'M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11Z',
  sun: 'M12 3V1M12 23v-2M3 12H1M23 12h-2M5 5 3 3M21 21l-2-2M5 19l-2 2M21 3l-2 2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z M7 9h10M7 13h7',
  files: 'M9 3h7l4 4v13H8V3h1Zm7 0v5h4M4 7v14M11 12h6M11 16h6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  motion: 'm10 3 10 9-10 9V3ZM3 7h3M2 12h4M3 17h3',
  palette:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3 9 9 0 0 0-9-7ZM7 9h.01M12 7h.01M17 9h.01M7 14h.01',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  plus: 'M12 5v14M5 12h14',
  import: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  notes: 'M5 3h11l3 3v15H5zM15 3v5h4M8 12h8M8 16h6',
  diagram: 'M8 3h8v5H8zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4',
  theme: 'm9 3 3 2 3-2 6 5-4 4-2-2v11H9V10l-2 2-4-4 6-5Z',
  chevron: 'm9 5 7 7-7 7',
  panel: 'M3 4h18v16H3zM9 4v16',
  close: 'm6 6 12 12M6 18 18 6',
  refresh: 'M20 7V3l-3 3a8 8 0 1 0 3 10M20 3h-5',
  branch: 'M6 3v12a4 4 0 0 0 4 4h2M18 3v4a5 5 0 0 1-5 5H6M4 3h4M16 3h4M12 17v4',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
}
</script>

<template>
  <Svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <SvgPath :d="paths[name] ?? paths.grid" />
  </Svg>
</template>

<style scoped>
svg {
  display: block;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}
</style>
