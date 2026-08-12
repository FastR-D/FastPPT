<template>
  <div class="slidev-layout sk-stats">
    <slot />
  </div>
</template>

<style scoped>
.sk-stats {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3.2rem;
  position: relative;
}

.sk-stats :deep(.sk-stat-row) {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 2rem;
}
</style>
