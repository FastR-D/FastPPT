<template>
  <div class="slidev-layout sk-two-cols">
    <div class="sk-col-head"><slot /></div>
    <div class="sk-col"><slot name="left" /></div>
    <div class="sk-col"><slot name="right" /></div>
  </div>
</template>

<style scoped>
.sk-two-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr;
  column-gap: 4rem;
  align-items: start;
  position: relative;
}

.sk-col-head {
  grid-column: 1 / -1;
}

.sk-col-head:empty {
  display: none;
}

.sk-col {
  min-width: 0;
  align-self: center;
}

.sk-col :deep(li) {
  font-size: 1.7rem;
}
</style>
