<script setup lang="ts">
import { useLogo } from '../scripts/logo'

// "Zwei Inhalte": full-width title (default slot) + two columns. Chrome via DbFrame.
// Column ratio is configurable per slide via the `columns` frontmatter, e.g.
//   layout: two-cols-header
//   columns: 3fr 2fr      # 60/40   (default is 1fr 1fr = 50/50)
const props = defineProps({
  columns: { type: String, default: '1fr 1fr' },
  codeSize: { type: String, default: '' },
})

useLogo({ ddrg: 'color', footer: true })
</script>

<template>
  <DbFrame :code-size="props.codeSize">
    <div class="db-header"><slot /></div>

    <div class="db-grid" :style="{ gridTemplateColumns: props.columns }">
      <div class="db-grid__col"><slot name="left" /></div>
      <div class="db-grid__col"><slot name="right" /></div>
    </div>
  </DbFrame>
</template>

<style scoped>
.db-grid {
  display: grid;
  column-gap: 28px;
}
</style>
