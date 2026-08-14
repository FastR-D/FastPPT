<template>
  <div class="slidev-layout stg-end">
    <div class="stg-end-inner">
      <div class="stg-stripe"><span class="bar" /><span class="ticks" /></div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stg-end {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.stg-end-inner :deep(h1) {
  font-size: 2.4rem;
  color: var(--stg-green);
  margin: 0.6rem 0 0;
}
.stg-end-inner :deep(p) {
  color: var(--stg-muted);
}
</style>
