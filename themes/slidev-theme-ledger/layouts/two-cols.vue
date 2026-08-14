<template>
  <div class="slidev-layout led-two-cols">
    <div class="led-toprule" />
    <div class="led-two-cols-grid">
      <div class="col"><slot name="default" /></div>
      <div class="col"><slot name="right" /></div>
    </div>
  </div>
</template>

<style scoped>
.led-two-cols {
  display: flex;
  flex-direction: column;
}
.led-two-cols-grid {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.8rem;
  align-content: start;
}
.led-two-cols :deep(h1) {
  font-size: 1.7rem;
}
</style>
