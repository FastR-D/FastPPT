<template>
  <div class="slidev-layout mag-quote">
    <div class="mag-quote-inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mag-quote {
  display: flex;
  align-items: center;
  justify-content: center;
}
.mag-quote-inner {
  max-width: 70%;
}
.mag-quote-inner :deep(blockquote),
.mag-quote-inner :deep(h1) {
  font-family: var(--mag-serif);
  font-style: italic;
  font-weight: 400;
  font-size: 2.2rem;
  color: var(--mag-black);
  margin: 0;
}
.mag-quote-inner :deep(p) {
  color: var(--mag-gray);
}
</style>
