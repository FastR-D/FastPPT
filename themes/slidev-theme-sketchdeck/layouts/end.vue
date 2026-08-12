<template>
  <div class="slidev-layout sk-end">
    <slot />
    <div class="sk-end-notes"><slot name="notes" /></div>
  </div>
</template>

<style scoped>
.sk-end {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 2.2rem;
  padding: 8% 10%;
}

.sk-end :deep(h1) {
  font-size: 7.6rem;
  line-height: 0.95;
  margin: 0;
}

.sk-end-notes {
  display: flex;
  gap: 1.1rem;
  flex-wrap: wrap;
  justify-content: center;
}
</style>
