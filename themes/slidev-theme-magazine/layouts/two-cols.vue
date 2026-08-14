<template>
  <div class="slidev-layout mag-two-cols">
    <div class="col mag-hairline--top"><slot name="default" /></div>
    <div class="col mag-hairline--top"><slot name="right" /></div>
  </div>
</template>

<style scoped>
.mag-two-cols {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 1.8rem;
  align-content: start;
}
.mag-two-cols :deep(h1) {
  font-size: 1.7rem;
}
</style>
