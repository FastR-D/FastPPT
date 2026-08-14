<template>
  <div class="slidev-layout ext-section">
    <div class="ext-section-inner"><slot /></div>
  </div>
</template>

<style scoped>
.ext-section { display: flex; align-items: center; justify-content: center; }
.ext-section-inner :deep(h1) { font-size: 2.8rem; margin: 0; }
.ext-section-inner :deep(p) { color: var(--ext-muted); }
</style>
