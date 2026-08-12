<template>
  <div class="DebugGrid" aria-hidden="true">
    <div class="DebugGrid-Cells">
      <div v-for="cell in 144"
           :key="cell"
           class="DebugGrid-Cell" />
    </div>
  </div>
</template>

<style scoped>
.DebugGrid {
  position: absolute;
  inset: var(--theme-margin-top) var(--theme-margin-right) var(--theme-margin-bottom) var(--theme-margin-left);
  pointer-events: none;
  z-index: 2;
}

.DebugGrid-Cells {
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-columns: repeat(var(--theme-grid-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--theme-grid-rows), minmax(0, 1fr));
  gap: var(--theme-grid-gap);
}

.DebugGrid-Cell {
  background-color: rgba(255, 0, 170, 0.08);
  background-image:
    repeating-linear-gradient(
      to right,
      rgba(255, 0, 170, 0.10) 0 var(--theme-grid-module),
      rgba(255, 0, 170, 0.16) var(--theme-grid-module) calc(var(--theme-grid-module) * 2)
    ),
    repeating-linear-gradient(
      to left,
      rgba(255, 0, 170, 0.10) 0 var(--theme-grid-module),
      rgba(255, 0, 170, 0.16) var(--theme-grid-module) calc(var(--theme-grid-module) * 2)
    ),
    repeating-linear-gradient(
      to bottom,
      rgba(255, 0, 170, 0.10) 0 var(--theme-grid-module),
      rgba(255, 0, 170, 0.05) var(--theme-grid-module) calc(var(--theme-grid-module) * 2)
    );
  background-position: left top, right top, left top;
  background-size: var(--theme-cell-height) 100%, var(--theme-cell-height) 100%, 100% 100%;
  background-repeat: no-repeat, no-repeat, repeat;
}
</style>
