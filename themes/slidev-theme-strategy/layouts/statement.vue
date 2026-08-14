<template>
  <div class="slidev-layout stg-statement">
    <div class="stg-statement-inner">
      <div class="stg-stripe"><span class="bar" /><span class="ticks" /></div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stg-statement {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.stg-statement-inner {
  max-width: 82%;
}
.stg-statement-inner :deep(h1) {
  font-size: 2.6rem;
  line-height: 1.3;
  margin: 0.6rem 0 0;
}
.stg-statement-inner :deep(mark),
.stg-statement-inner :deep(strong) {
  color: var(--stg-green);
  background: var(--stg-mint);
  padding: 0 0.2em;
}
</style>
