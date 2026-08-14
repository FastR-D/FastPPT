<template>
  <div class="slidev-layout led-end">
    <div class="led-end-inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.led-end {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.led-end-inner :deep(h1) {
  font-family: var(--led-serif);
  font-size: 2.6rem;
  border-bottom: none;
  margin: 0;
}
.led-end-inner :deep(p) {
  color: var(--led-gray);
}
</style>
