<template>
  <div class="slidev-layout ext-cover">
    <div class="ext-cover-inner">
      <span class="ext-pill">crimson-violet</span>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.ext-cover { display: flex; align-items: center; }
.ext-cover-inner { max-width: 76%; }
.ext-cover-inner :deep(h1) { font-size: 3rem; margin: 0.4rem 0 0; }
.ext-cover-inner :deep(p) { color: var(--ext-muted); font-size: 1.1rem; }
</style>
