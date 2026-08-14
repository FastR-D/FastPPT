<template>
  <div class="slidev-layout stg-quote">
    <div class="stg-quote-mark">&ldquo;</div>
    <slot />
  </div>
</template>

<style scoped>
.stg-quote {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 6rem;
}
.stg-quote-mark {
  font-family: 'Noto Serif SC', serif;
  font-size: 5rem;
  line-height: 1;
  color: var(--stg-accent);
}
.stg-quote :deep(h1),
.stg-quote :deep(blockquote) {
  font-family: 'Noto Serif SC', serif;
  font-weight: 600;
  font-size: 2rem;
  color: var(--stg-green);
  margin: 0;
}
.stg-quote :deep(p) {
  color: var(--stg-muted);
  font-size: 1rem;
}
</style>
