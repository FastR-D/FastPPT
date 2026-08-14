<template>
  <div class="slidev-layout led-section">
    <div class="led-toprule" />
    <div class="led-section-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.led-section {
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.led-section-body :deep(h1) {
  font-size: 3rem;
  font-family: var(--led-serif);
  border-bottom: none;
  margin: 0;
}
.led-section-body :deep(p) {
  font-size: 1.1rem;
  color: var(--led-gray);
}
</style>
