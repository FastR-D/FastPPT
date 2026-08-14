<template>
  <div class="slidev-layout led-quote">
    <div class="led-quote-mark">&ldquo;</div>
    <slot />
  </div>
</template>

<style scoped>
.led-quote {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 5rem;
}
.led-quote-mark {
  font-family: var(--led-serif);
  font-size: 4.5rem;
  color: var(--led-teal);
  line-height: 1;
}
.led-quote :deep(blockquote),
.led-quote :deep(h1) {
  font-family: var(--led-serif);
  font-weight: 400;
  font-size: 1.9rem;
  color: var(--led-ink);
  margin: 0;
  border-bottom: none;
}
.led-quote :deep(p) {
  color: var(--led-gray);
}
</style>
