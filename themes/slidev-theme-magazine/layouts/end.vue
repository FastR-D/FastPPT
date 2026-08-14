<template>
  <div class="slidev-layout mag-end">
    <div class="mag-end-inner"><slot /></div>
  </div>
</template>

<style scoped>
.mag-end {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.mag-end-inner :deep(h1) {
  font-family: var(--mag-serif);
  font-size: 2.6rem;
  margin: 0;
}
.mag-end-inner :deep(p) {
  color: var(--mag-gray);
}
</style>
