<template>
  <div class="slidev-layout sk-default">
    <slot />
  </div>
</template>

<style scoped>
.sk-default {
  display: flex;
  flex-direction: column;
  position: relative;
}

.sk-default :deep(li) {
  font-size: 2.1rem;
  line-height: 1.35;
}
</style>
