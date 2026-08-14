<template>
  <div class="slidev-layout led-statement">
    <div class="led-toprule" />
    <div class="led-statement-inner">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.led-statement {
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
}
.led-statement .led-toprule {
  margin-left: auto;
  margin-right: auto;
}
.led-statement-inner :deep(h1) {
  font-size: 2.6rem;
  font-family: var(--led-serif);
  border-bottom: none;
  margin: 0;
}
.led-statement-inner :deep(strong) {
  color: var(--led-teal-dark);
}
</style>
