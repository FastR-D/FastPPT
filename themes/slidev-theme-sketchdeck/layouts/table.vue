<template>
  <div class="slidev-layout sk-table">
    <slot />
  </div>
</template>

<style scoped>
.sk-table {
  display: flex;
  flex-direction: column;
  gap: 1.6rem;
  justify-content: center;
  position: relative;
}

.sk-table :deep(table) {
  font-size: 1.55rem;
}
</style>
