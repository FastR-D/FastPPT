<template>
  <div class="slidev-layout ext-end">
    <div class="ext-end-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-end { display: flex; align-items: center; justify-content: center; text-align: center; }
.ext-end-inner :deep(h1) { font-size: 2.4rem; margin: 0; }
.ext-end-inner :deep(p) { color: var(--ext-muted); }
</style>
