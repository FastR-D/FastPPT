<script setup lang="ts">
import { useLogo } from '../scripts/logo'

// Like two-cols-header, but the two columns are laid out as a ROW GRID: every
// top-level <div> in the `::grid::` slot becomes a cell, filling left, right,
// left, right… Because CSS grid rows align across columns, paired items (e.g. a
// heading on the left and one on the right) line up automatically and stay
// aligned when content changes.
//
//   ---
//   layout: two-cols-grid
//   columns: 55fr 45fr        # optional ratio (default 1fr 1fr)
//   ---
//   # Title
//   ::grid::
//   <div> … left of row 1 … </div>
//   <div> … right of row 1 … </div>
//   <div> … left of row 2 … </div>
//   <div> … right of row 2 … </div>
const props = defineProps({
  columns: { type: String, default: '1fr 1fr' },
  codeSize: { type: String, default: '' },
})

useLogo({ ddrg: 'color', footer: true })
</script>

<template>
  <DbFrame :code-size="props.codeSize">
    <div class="db-header"><slot /></div>

    <div class="db-rowgrid" :style="{ gridTemplateColumns: props.columns }">
      <slot name="grid" />
    </div>
  </DbFrame>
</template>

<style scoped>
.db-rowgrid {
  display: grid;
  column-gap: 28px;
  row-gap: 12px;
  align-items: start;   /* each cell starts at the top of its row */
}
</style>
