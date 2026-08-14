<template>
  <div class="slidev-layout stg-two-cols">
    <div class="col">
      <slot name="default" />
    </div>
    <div class="col stg-explain-col">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.stg-two-cols {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 1.8rem;
  align-content: start;
}
.stg-two-cols :deep(h1) {
  font-size: 1.7rem;
}
.stg-explain-col :deep(*) {
  background: var(--stg-surface);
  padding: 0.9rem 1.1rem;
  font-size: 0.9rem;
}
</style>
