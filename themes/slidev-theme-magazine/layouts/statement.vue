<template>
  <div class="slidev-layout mag-statement">
    <div class="mag-statement-inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mag-statement {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.mag-statement-inner {
  max-width: 80%;
}
.mag-statement-inner :deep(h1) {
  font-family: var(--mag-serif);
  font-size: 2.6rem;
  line-height: 1.3;
  margin: 0;
}
.mag-statement-inner :deep(strong) {
  color: var(--mag-copper);
}
</style>
