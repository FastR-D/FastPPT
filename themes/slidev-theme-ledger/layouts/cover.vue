<template>
  <div class="slidev-layout led-cover">
    <div class="led-toprule led-toprule--cover" />
    <div class="led-cover-title">
      <slot />
    </div>
    <div class="led-cover-keys">
      <ul class="led-ticks"><slot name="keys" /></ul>
    </div>
  </div>
</template>

<style scoped>
.led-cover {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 4.5rem;
}
.led-cover-title :deep(h1) {
  font-size: 3.2rem;
  font-family: var(--led-serif);
  border-bottom: none;
  margin: 0.4rem 0 0.3rem;
}
.led-cover-title :deep(p) {
  font-size: 1.15rem;
  color: var(--led-gray);
}
.led-cover-keys {
  margin-top: 2rem;
  max-width: 60%;
}
.led-cover-keys :deep(li) {
  font-size: 1rem;
  margin: 0.5rem 0;
}
</style>
